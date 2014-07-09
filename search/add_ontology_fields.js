/*
The genes collection of the search db contains a document for each gene. A gene
may be annotated with terms from an ontology such as the NCBI taxonomy, GO, or PO.
A user may wish to find genes with a specific term or to broaden the search to
include genes annotated with the query term or any more specific descendant term.
This subgraph query can be made efficient by adding a field that contains a pair
of numbers based on a preorder traversal of the ontology. In the case of a tree
such as the NCBI taxonomy, there is one pair per node, since you would visit
each node only one time on a preorder traversal. However, other ontologies are
directed acyclic graphs (DAG) where it is possible for a node to have multiple
ancestor nodes. Therefore, these nodes will have multiple pairs. The pairs are
indexed in MongoDB as 2d points on a plane and queried using $geoWithin. The
2d index was designed for latitude and longitude, but may be used for any range
of numbers.

The ontologies db has a collection of terms for each ontology. The _id of
a term is just the numerical portion (e.g., "GO:0001234" becomes 1234) and the
LR field holds the list of preorder traversal pairs.

In order to make the subtree queries possible in the genes collection, we have to
add LR fields from the ontologies db. This script reads each gene document from
a stream of JSON documents (one per line), looks up the LR pairs for the
annotated term(s), updates the numGenes.direct and numGenes.subgraph in the
ontology db, and outputs an updated JSON document for the gene.


establish database connection to the ontologies db
read input file line by line
obj = JSON.parse(line)
obj.xrefs.GO holds a list of GO terms
obj.xrefs.PO holds a list of PO terms
obj.taxon_id is the ncbi taxonomy id

the ontologies db has collections:
go, plant_ontology, trait, ncbitaxon

it would be nice to manage this mapping outside of the code.
*/

var collectionLUT = {
    'xrefs:GO' : {LRfield: 'GO', ontology: 'go'},
    'xrefs:TO' : {LRfield: 'TO', ontology: 'trait'},
    'xrefs:PO' : {LRfield: 'PO', ontology: 'plant_ontology'},
    'taxon_id' : {LRfield: 'taxon', ontology: 'ncbitaxon'}
};

var MongoClient = require('mongodb').MongoClient;
var fs = require('fs');
var async = require('async');
var filename = process.argv[2];

// given a list of terms, this is how you get the
// LR pairs from collection.aggregate()
function LRQuery(terms) {
    return [
        { $match : { _id : { $in : terms } } },
        { $project : { LR : 1 , _id : 0 } },
        { $unwind : "$LR" },
        { $group : { _id : "NA", LR : { $push : "$LR" } } },
        { $project : { LR : 1 , _id : 0 } }
        ];
}

// given a list of terms, this is how you update
// the numGenes.direct
// tbd

// given a set of LR pairs, this is how you update
// the numGenes.subgraph
// tbd

// retrieve a subObject based on a list of keys
function getField(o,keys) {
    var subObj = o;
    for(var i in keys) {
        if (subObj.hasOwnProperty(keys[i])) {
            subObj = subObj[keys[i]];
        }
        else {
            return undefined;
        }
    }
    return subObj;
}

// convert a list of ontology terms from strings to integers
function termsToInts(terms) {
    for(var i in terms) {
        terms[i] = parseInt(terms[i].replace(/[A-Z]+:0*/, ""));
    }
    return terms;
}

// connect to the ontologies database
MongoClient.connect('mongodb://127.0.0.1:27017/ontologies', function(err, db) {
    if(err) throw err;

    // setup reader
    require('readline').createInterface({
        input: fs.createReadStream(filename),
        terminal: false
    }).on('line', function(line) { // one JSON object per line
       var obj = JSON.parse(line);

       // Parallel ontology query functions
       var queryFunctions = [];

       // Functor necessary to ensure 'field' variable closure
       function queryFunctor(field) {
           "use strict";
           return function (done) {
               var terms = getField(obj, field.split(':'));
               var coll;
               if (terms) {
                   if (typeof terms[0] === "string") {
                       terms = termsToInts(terms);
                   }

                   // increment numGenes.direct based on terms

                   console.log(field,terms);
                   coll = db.collection(collectionLUT[field].ontology);
               }
               done(null, coll);
           };
       }

       // Populate query functions
       for(var field in collectionLUT) {
           queryFunctions.push(queryFunctor(field));
       }
       
       // Run queries in parallel
       async.parallel(queryFunctions, function (err, collections) {
           collections.forEach(function (coll) {
               coll.aggregate(LRQuery(terms), function(err, result) {
                   console.log("after aggregate",field,terms,result[0].LR);
                   // set the appropriate LRfield
                   obj[collectionLUT[field].LRfield] = result[0].LR;
                   // increment numGenes.subgraph based on result[0].LR
               });
           });
           // now that the object has been updated, output it as JSON
           // this can't happen until obj has been updated.
           console.log(JSON.stringify(obj));
       });
    }).on('close', function() {
        // close the database connection, but give the currently running commands
        // some time to finish - PS I don't like this.
        setTimeout(function() {
            db.close();
        }, 5000);
    });
});

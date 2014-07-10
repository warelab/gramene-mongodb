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
    var ints = [];
    if (typeof terms === "object") {
        for(var i in terms) {
            if (typeof terms[i] === "string") {
                ints.push(parseInt(terms[i].replace(/[A-Z]+:0*/, "")));
            }
            else {
                ints.push(terms[i]);
            }
        }
    }
    else {
        ints.push(terms);
    }
    return ints;
}

// connect to the ontologies database
MongoClient.connect('mongodb://127.0.0.1:27017/ontologies', function(err, db) {
    if (err) throw err;

    // setup reader
    require('readline').createInterface({
        input: fs.createReadStream(filename),
        terminal: false
    }).on('line', function(line) { // one JSON object per line
       var obj = JSON.parse(line);

       // Parallel ontology query functions
       var queryFunctions = {};

       // Functor necessary for variable closure
       function aggregateFunctor(coll,pipeline) {
           "use strict";
           return function (done) {
               coll.aggregate(pipeline, function(err,result) {
                   if (result) done(null, result[0].LR);
                   else done(null, null);
               });
           };
       }

       // Populate query functions
       for(var field in collectionLUT) {
           var terms = getField(obj, field.split(':'));
           if (terms) {
               var ints = termsToInts(terms);
               var o = collectionLUT[field];
               queryFunctions[o.LRfield] =
                   aggregateFunctor(db.collection(o.ontology),LRQuery(ints));
           }
       }

       if (queryFunctions) {
           // Run queries in parallel
           async.parallel(queryFunctions, function (err, LR) {
               if (err) throw err;
               obj.LR = LR;
               console.log(JSON.stringify(obj));
           });
       }
       else {
           console.log(line);
       }
    }).on('close', function() {
        // close the database connection, but give the currently running commands
        setTimeout(function() {
            db.close();
        }, 5000);
    });
});

#!/usr/bin/env node
/*
The genes collection of the search db contains a document for each gene. A gene
may be annotated with terms from an ontology such as the NCBI taxonomy, GO, or PO.
A user may wish to find genes with a specific term or to broaden the search to
include genes annotated with the query term or any more specific descendant term.

The ontology db has a collection of terms for each ontology. The _id of
a term is just the numerical portion (e.g., "GO:0001234" becomes 1234) and the
ancestors field holds the transitive closure of more general terms.

In order to make the subtree queries possible in the genes collection, we have to
add ancestors fields from the ontology db. This script reads each gene document from
a stream of JSON documents (one per line), looks up the ancestors for the
annotated term(s), and outputs an updated JSON document for the gene.
*/

var mongoURL = 'mongodb://127.0.0.1:27017/ontology';

var collectionLUT = {
    // 'xrefs:goslim_goa' : 'GO', // skipped because it is a subset of GO
    'xrefs:GO' : 'GO',
    'xrefs:TO' : 'TO',
    'xrefs:PO' : 'PO',
    'taxon_id' : 'NCBITaxon',
    'protein_features:interpro' : 'interpro'
};

var MongoClient = require('mongodb').MongoClient;
var fs = require('fs');
var async = require('async');
var filename = process.argv[2];

// given a list of terms, this is how you get all the ancestors
function Ancestors(terms) {
    return [
    { $match : { _id : { $in : terms } } },
    { $project : { ancestors : 1, _id : 0 } },
    { $unwind : "$ancestors" },
    { $group : { _id: "NA", ancestors : { $addToSet : "$ancestors" } } },
    { $project : { ancestors : 1, _id : 0 } }
    ];
}

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

// convert a list of ontology terms from strings
// to a list of integers
function termsToInts(terms) {
    var ints = [];
    if (typeof terms === "object") {
        for(var i in terms) {
            if (typeof terms[i] === "string") {
                ints.push(parseInt(terms[i].match(/\d+/)));
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

// convert a list of ontology terms from strings to integers in place
function termsToIntsReplace(terms) {
    if (typeof terms === "object") {
        for(var i in terms) {
            if (typeof terms[i] === "string") {
                // terms[i] = parseInt(terms[i].replace(/[A-Z]+:0*/, ""));
                terms[i] = parseInt(terms[i].match(/\d+/));
            }
        }
        return terms;
    }
    return [terms]; // special case for singletons (taxon_id)
}

// connect to the ontologies database
MongoClient.connect(mongoURL, function(err, db) {
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
                 if (err) throw err;
                   if (typeof result[0] === "object") done(null, result[0].ancestors);
                   else done(null, null);
               });
           };
       }

       // Populate query functions
       for(var field in collectionLUT) {
           var terms = getField(obj, field.split(':'));
           if (terms) {
             // terms might now be an object where keys are evidence codes, and values are arrays of terms
             if (Array.isArray(terms) || typeof terms !== "object") { // nope, just an array or a non-object
               // var ints = termsToInts(terms);
               var ints = termsToIntsReplace(terms);
               var o = collectionLUT[field];
               var coll = db.collection(o);
               queryFunctions[o] = aggregateFunctor(coll,Ancestors(ints));
             }
             else { // object with evidence code keys
               var allInts = {};
               var o = collectionLUT[field];
               var coll = db.collection(o);
               for (var ec in terms) {
                 var ints;
                 // console.log('terms['+ec+']=',terms[ec]);
                 // if (typeof terms[ec] === "object") {
                 //   ints = termsToIntsReplace(Object.keys(terms[ec]));
                 // }
                 // else {
                   ints = termsToIntsReplace(terms[ec]);
                 // }
                 // console.log(ints);
                 // process.exit(2);
                 queryFunctions[o+"_"+ec] = aggregateFunctor(coll,Ancestors(ints));
                 for(var i=0; i < ints.length; i++) { allInts[ints[i]]=1; };
               }
               var intarray = Object.keys(allInts).map(function(x){return +x});
               queryFunctions[o] = aggregateFunctor(coll,Ancestors(intarray));
             }
           }
       }

       if (queryFunctions) {
           // Run queries in parallel
           async.parallel(queryFunctions, function (err, ancestors) {
               if (err) throw err;
               obj.ancestors = ancestors;
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

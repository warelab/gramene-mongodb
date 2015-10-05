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
// assumes all collections are in the same mongo db as GO
var GOdb = require('../config/collections.js').GO;
var mongoURL = 'mongodb://'
  + GOdb.host + ':' + GOdb.port + '/' + GOdb.dbName;

var MongoClient = require('mongodb').MongoClient;
var fs = require('fs');
var async = require('async');

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

// connect to the ontologies database
MongoClient.connect(mongoURL, function(err, db) {
    if (err) throw err;

    // setup reader
    require('readline').createInterface({
      input: process.stdin,
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
       function to_int(list) {
         return list.map(function(item) { return parseInt(item.match(/\d+/)) });
       }

       queryFunctions.taxon_id = aggregateFunctor(db.collection('NCBITaxon'),Ancestors([obj.taxon_id]));
       if (!!obj.xrefs.GO) {
         queryFunctions.GO = aggregateFunctor(db.collection('GO'),Ancestors(to_int(obj.xrefs.GO)));
       }
       if (!!obj.xrefs.PO) {
         queryFunctions.PO = aggregateFunctor(db.collection('PO'),Ancestors(to_int(obj.xrefs.PO)));
       }
       if (!!obj.xrefs.interpro) {
         queryFunctions.interpro = aggregateFunctor(db.collection('interpro'),Ancestors(to_int(obj.xrefs.interpro)));
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

#!/usr/bin/env node
var MongoClient = require('mongodb').MongoClient;
var _ = require('lodash');
var collections = require('../config/collections.js');
var Q = require('q');

var xrefsToProcess = ['domains','GO','PO','taxonomy'];
function modifyGeneDocs(ancestorsLUT) {
  require('readline').createInterface({
    input: process.stdin,
    terminal: false
  }).on('line', function (line) { // one JSON object per line
    var obj = JSON.parse(line);
    obj.ancestors = {};
    obj.xrefs.taxonomy = ['NCBITaxon:'+obj.taxon_id]; // temporary xref to make loops happy
    xrefsToProcess.forEach(function(x) {
      if (obj.xrefs.hasOwnProperty(x)) {
        var lut = {};
        obj.xrefs[x].forEach(function(id) {
          if (ancestorsLUT[x].hasOwnProperty(id)) {
            ancestorsLUT[x][id].forEach(function(anc) {
              lut[anc]=1;
            });
          }
        });
        if (Object.keys(lut).length > 0) {
          obj.ancestors[x] = Object.keys(lut).map(function(a){return +a});
        }
        delete obj.xrefs[x];
      }
    });
    delete obj.xrefs.taxonomy;
    console.log(JSON.stringify(obj));
  });
}

// create a lookup table from the documents in each aux core
var promises = xrefsToProcess.map(function(x) {
  var deferred = Q.defer();
  var lut = {};
  
  var coll = collections[x];
  var mongoURL = 'mongodb://'
    + coll.host + ':' + coll.port + '/' + coll.dbName;

  // connect to the mongo database
  MongoClient.connect(mongoURL, function (err, db) {
    if (err) deferred.reject(err);
    db.collection(coll.collectionName).find({},{id:1,ancestors:1}).toArray(function (err, docs) {
      if (err) deferred.reject(err);
      docs.forEach(function(doc) {
        lut[doc.id] = doc.ancestors;
      });
      db.close();
      deferred.resolve(lut);
    });
  });
  
  return deferred.promise;
});

Q.all(promises).then(function(luts) {
  var superLut = _.zipObject(xrefsToProcess, luts);
  modifyGeneDocs(superLut);
});


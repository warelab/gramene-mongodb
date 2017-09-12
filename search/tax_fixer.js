#!/usr/bin/env node
var Q = require('q');
var through2 = require('through2');
var _ = require('lodash')
var collections = require('gramene-mongodb-config');

function getMaps() {
  var deferred = Q.defer();
  collections.maps.mongoCollection().then(function (coll) {
    coll.find({type: 'genome'}, {}).toArray(function (err, genomes) {
      if (err) throw deferred.reject(new Error(err));
      // collections.closeMongoDatabase();
      var taxFixes = {};
      genomes.forEach(function(g) {
        taxFixes[g.system_name] = g.taxon_id
      });
      console.error("tax fixer lut ready");
      deferred.resolve(taxFixes);
    });
  });
  return deferred.promise;
}

module.exports = function() {
  
  var mapsPromise = getMaps();
  
  return through2.obj(function (gene, enc, done) {
    var that = this;
  
    mapsPromise.then(function(maps) {
      gene.taxon_id = maps[gene.system_name];
      that.push(gene);
      done();
    });
  });  
}


#!/usr/bin/env node
var Q = require('q');
var through2 = require('through2');
var _ = require('lodash')
var collections = require('gramene-mongodb-config');

function getQTLs() {
  var deferred = Q.defer();
  var qtl_locations = {};
  collections.qtls.mongoCollection().then(function(coll) {
    coll.find().toArray(function(err, result) {
      if (err) throw err;
      result.forEach(function(qtl) {
        qtl_locations[qtl.location.map] ||= {};
        qtl_locations[qtl.location.map][qtl.location.region] ||= [];
        qtl_locations[qtl.location.map][qtl.location.region].push({
          start: qtl.location.start,
          end: qtl.location.end,
          id: qtl._id
        });
      });
      deferred.resolve(qtl_locations);
    });
  });
  return deferred.promise;
}

module.exports = function() {
  
  var qtlsPromise = getQTLs();
  
  return through2.obj(function (gene, enc, callback) {
    var that = this;
    qtlsPromise.then(function(qtls) {
      console.error('find', gene.location, Object.keys(qtls));
      if (qtls.hasOwnProperty(gene.location.map) && qtls[gene.location.map].hasOwnProperty(gene.location.region)) {
        // find overlapping qtls
        console.error("find",gene.location,"in",qtls[gene.location.map][gene.location.region])
      }
      that.push(gene);
      callback();
    });
  });  
}

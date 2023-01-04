#!/usr/bin/env node
var Q = require('q');
var through2 = require('through2');
var _ = require('lodash')
var bounds = require('binary-search-bounds');
var collections = require('gramene-mongodb-config');

function compareIntervals(a,b) { return a.start - b.start };

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
          id: qtl._id,
          terms: qtl.terms
        });
      });
      Object.keys(qtl_locations).forEach(function(map) {
        Object.keys(qtl_locations[map]).forEach(function(region) {
          qtl_locations[map][region].sort(compareIntervals)
        })
      })
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
      // console.error('find', gene.location, Object.keys(qtls));
      if (qtls.hasOwnProperty(gene.location.map) && qtls[gene.location.map].hasOwnProperty(gene.location.region)) {
        // find overlapping qtls
        // console.error("find",gene.location,"in",qtls[gene.location.map][gene.location.region])
        intervals = qtls[gene.location.map][gene.location.region];
        var le = bounds.le(intervals, gene.location, compareIntervals);
        var terms = {}
        var found=0;
        while (intervals[le] && intervals[le].start <= gene.location.start) { // gene completely within QTL
          if (intervals[le].end >= gene.location.end) {
            intervals[le].terms.forEach(function(t) { terms[t]=1 })
            // console.error("found",gene.location,intervals[le])
            found++;
          }
          le++
        }
        if (found > 0) {
          gene.xrefs.push({db:'QTL_TO', ids:Object.keys(terms)})
          // console.error('QTL',gene._id,gene.xrefs);
        }
      }
      that.push(gene);
      callback();
    });
  });  
}

#!/usr/bin/env node
// load the ordered set of maps
// create binMappers for various binning options
// 1. uniform width bins of 1Mb, 2Mb, 5Mb, 10Mb, etc
// 2. fixed number of bins per genome 100, 200, 500, 1000
// iterate over gene documents and add bin fields to each document
// based on the TSS of the gene
var Q = require('q');
var through2 = require('through2');
var _ = require('lodash')
var collections = require('gramene-mongodb-config');

function getMapper(sizes) {
  var deferred = Q.defer();
  collections.maps.mongoCollection().then(function (coll) {
    coll.find({type: 'genome'}, {}).toArray(function (err, genomes) {
      if (err) throw deferred.reject(new Error(err));
      // collections.closeMongoDatabase();
      var binsGenerator = require('gramene-bins-client');
      var bins = binsGenerator.bins(genomes);
      var mappers = {};
      sizes.fixed.forEach(function(size) {
        mappers['fixed_'+size] = bins.fixedBinMapper(size);
      });
      sizes.uniform.forEach(function(mb) {
        mappers['uniform_'+mb+'Mb'] = bins.uniformBinMapper(mb*1000000);
      });
      deferred.resolve(mappers);
    });
  });
  return deferred.promise;
}

module.exports = function(sizes) {
  
  var mapperPromise = getMapper(sizes);
  
  return through2.obj(function (gene, enc, done) {
    var that = this;

    if(gene.bins) {
      throw new Error('bins already defined on ' + gene._id);
    }
  
    if(!_.isObject(gene) || !_.isNumber(gene.taxon_id) || !_.isObject(gene.location)) {
      throw new Error('gene is lacking needed info');
    }
  
    mapperPromise.then(function(mapper) {
      gene.bins = {};
      for (var field in mapper) {
        var bin = mapper[field].pos2bin(gene.taxon_id, gene.location.region, gene.location.start);
        gene.bins[field] = bin;
      }
      that.push(gene);
      done();
    });
  });  
}


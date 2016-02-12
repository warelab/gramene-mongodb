#!/usr/bin/env node
var Q = require('q');
var through2 = require('through2');
var _ = require('lodash')

function getRedis(db) {
  var deferred = Q.defer();
  var client = require('redis').createClient();
  client.select(db, function(err) {
    if (err) throw err;
    deferred.resolve(client);
  });
  return deferred.promise;
}

module.exports = function(db) {
  
  var redisPromise = getRedis(db);
  
  return through2.obj(function (gene, enc, done) {
    var that = this;
  
    redisPromise.then(function(client) {

      client.hgetall(gene._id, function (err, homologs) {
        if (err) throw err;
        if (!gene.hasOwnProperty('homology')) {
          gene.homology = {};
        }
        for (var geneId in homologs) {
          var k = homologs[geneId];
          if (!gene.homology.hasOwnProperty(k)) {
            gene.homology[k] = [];
          }
          gene.homology[k].push(geneId);
        }
        that.push(gene);
        done();
      });
    });
  });
}

#!/usr/bin/env node
var Q = require('q');
var through2 = require('through2');
var _ = require('lodash')

function getRedis(db) {
  var deferred = Q.defer();
  var client = require('redis').createClient();
  client.select(db, function(err) {
    if (err) throw err;
    console.error('generifs redis connection established');
    deferred.resolve(client);
  });
  return deferred.promise;
}

module.exports = function(db) {
  
  var redisPromise = getRedis(db);
  
  return through2.obj(function (gene, enc, done) {
    var that = this;
  
    redisPromise.then(function(client) {

      client.get(gene._id, function (err, jsonstr) {
        if (err) throw err;
        if (gene.taxon_id !== 4565007 && jsonstr) {
          generifs = JSON.parse(jsonstr);
          // console.error(gene._id, generifs);
          generifs.forEach(gr => {
            gene.xrefs.push({
              db: 'PUBMED',
              source: 'geneRIF',
              text: gr.geneRIF,
              ids: gr.pubmed
            })
          })
        }
        that.push(gene);
        done();
      });
    });
  });
}

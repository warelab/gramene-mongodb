#!/usr/bin/env node
var Q = require('q');
var through2 = require('through2');
var _ = require('lodash');
var request = require('request');

// ThaleMine's absent-value sentinels, as they arrive over the tab format.
function usable(v) {
  return !!v && v !== 'NULL' && v !== '""' && v !== '\\N' && v.trim() !== '';
}

function getThalemine() {
  var deferred = Q.defer();
  var url = 'https://bar.utoronto.ca/thalemine/service/query/results?query=%3Cquery+name%3D%22%22+model%3D%22genomic%22+view%3D%22Gene.primaryIdentifier+Gene.symbol+Gene.tairCuratorSummary+Gene.briefDescription%22+longDescription%3D%22%22+sortOrder%3D%22Gene.primaryIdentifier+asc%22%3E%3Cconstraint+path%3D%22Gene.symbol%22+op%3D%22IS+NOT+NULL%22%2F%3E%3C%2Fquery%3E&format=tab';
  console.error('thalemine get('+url+')');
  request.get(url, function(err,response,body) {
    if (err) throw err;
    var lines = body.split("\n");
    var lut = {};
    lines.forEach(function(line) {
      var cols = line.split("\t");
      lut[cols[0]] = {
        symbol: cols[1],
        curatorSummary: cols[2],
        briefDescription: cols[3]
      };
    });
    console.error('thalemine lookup table');
    deferred.resolve(lut);
  });

  return deferred.promise;
}

module.exports = function() {
  
  var thaleminePromise = getThalemine();
  
  return through2.obj(function (gene, enc, done) {
    var that = this;

    if(!_.isObject(gene)) {
      throw new Error('gene is lacking needed info');
    }
  
    thaleminePromise.then(function(lut) {
      if (lut[gene._id]) {
        // ThaleMine returns the four-character string "NULL" for an absent value, on 19,850 of its
        // 38,194 rows. The old guard only screened '""', so "NULL" was written straight into
        // gene.summary -- 15,511 Arabidopsis docs in the live collection carry it, and it reaches
        // the index and the API. The client happens to screen it (GeneList.js: summary !== "NULL"),
        // so nothing displays wrong today, but it inflates every summary count and any new consumer
        // of the field would have to know the sentinel. Screen it here instead.
        if (usable(lut[gene._id].curatorSummary)) gene.summary = lut[gene._id].curatorSummary;
        if (usable(lut[gene._id].briefDescription)) gene.description = lut[gene._id].briefDescription;
        // Guarded on the symbol too: the query constrains symbol IS NOT NULL, but a header or
        // trailing line would otherwise set gene.name to a sentinel or the empty string.
        if (gene.name === gene._id && usable(lut[gene._id].symbol)) gene.name = lut[gene._id].symbol;
      }
      that.push(gene);
      done();
    });
  });
}


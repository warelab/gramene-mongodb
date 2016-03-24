#!/usr/bin/env node
var Q = require('q');
var through2 = require('through2');
var _ = require('lodash');
var request = require('request');

function getThalemine() {
  var deferred = Q.defer();
  var url = 'https://apps.araport.org/thalemine/service/query/results?query=%3Cquery+name%3D%22%22+model%3D%22genomic%22+view%3D%22Gene.primaryIdentifier+Gene.curatorSummary+Gene.briefDescription%22+longDescription%3D%22%22+sortOrder%3D%22Gene.primaryIdentifier+asc%22%3E%3Cconstraint+path%3D%22Gene.curatorSummary%22+op%3D%22IS+NOT+NULL%22%2F%3E%3C%2Fquery%3E&format=tab';
  request.get(url, function(err,response,body) {
    if (err) throw err;
    var lines = body.split("\n");
    var lut = {};
    lines.forEach(function(line) {
      var cols = line.split("\t");
      lut[cols[0]] = {
          curatorSummary: cols[1],
          briefDescription: cols[2]
      };
    });
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
        gene.summary = lut[gene._id].curatorSummary;
        gene.description = lut[gene._id].briefDescription;
      }
      that.push(gene);
      done();
    });
  });
}


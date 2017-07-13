#!/usr/bin/env node
var Q = require('q');
var through2 = require('through2');
var _ = require('lodash');

function getMapping() {
  var deferred = Q.defer();
  var lut = {};
  var filename = 'barley_id_mapping.txt';
  console.error('barley getMapping');
  require('readline').createInterface({
    input: require('fs').createReadStream(filename),
    terminal: false
  })
  .on('line', function(line) {
    var fields = line.split("\t");
    /*
      fields are
  0  current id (ensembl)
  1  old id
    */
    if (!lut.hasOwnProperty(fields[0])) {
      lut[fields[0]] = [];
    }
    lut[fields[0]].push(fields[1]);
  })
  .on('close', function() {
    console.error('loaded barley lut');
    deferred.resolve(lut);
  });
  return deferred.promise;
}

module.exports = function() {
  
  var lutPromise = getMapping();
  
  return through2.obj(function (gene, enc, done) {
    var that = this;

    if(!_.isObject(gene)) {
      throw new Error('gene is lacking needed info');
    }
  
    lutPromise.then(function(lut) {
      if (lut[gene._id]) {
        // merge with gene.synonyms
        if (!gene.hasOwnProperty('synonyms')) {
          gene.synonyms = [];
        }
        lut[gene._id].forEach(id => {
          if (id != '-') {
            gene.synonyms.push(id);
          }
        });
        gene.synonyms = _.uniq(gene.synonyms);
      }
      that.push(gene);
      done();
    });
  });
}


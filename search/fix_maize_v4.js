#!/usr/bin/env node
var Q = require('q');
var through2 = require('through2');
var _ = require('lodash');

function getMapping() {
  var deferred = Q.defer();
  var lut = {};
  var filename = 'v3v4.gene_ID_history_with_names.txt';
  console.error('fixMaizeV4 getMapping');
  require('readline').createInterface({
    input: require('fs').createReadStream(filename),
    terminal: false
  })
  .on('line', function(line) {
    var fields = line.split("\t");
    /*
      fields are
    v3 id
    float
    v4 id
    float
    v3 name
    v3 description
    */
    if (fields.length === 5) {
      fields.push(''); // because the description might be missing
    }
    if (fields.length === 6) {
      lut[fields[2]] = {id:fields[0], name:fields[4], description:fields[5]};
    }
  })
  .on('close', function() {
    console.error('loaded v3v4 lut');
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
        var v3 = lut[gene._id];
        gene.synonyms = [v3.id];
        if (v3.name != v3.id) {
          gene.name = v3.name;
        }
        if (v3.description && !v3.description.match(/Uncharacterized protein/)) {
          gene.description = v3.description;
        }
      }
      that.push(gene);
      done();
    });
  });
}


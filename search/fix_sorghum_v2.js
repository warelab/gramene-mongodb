#!/usr/bin/env node
var Q = require('q');
var through2 = require('through2');
var _ = require('lodash');

function getMapping() {
  var deferred = Q.defer();
  var lut = {};
  var filename = 'sorghum_v3_lut2.txt';
  console.error('fix_sorghum_v2 getMapping');
  require('readline').createInterface({
    input: require('fs').createReadStream(filename),
    terminal: false
  })
  .on('line', function(line) {
    var fields = line.split("\t");
    /*
      fields are
  0  ensembl id
  1  phytozome id
  2  v1 id
  3  defline if not '-'
    */
    if (!lut.hasOwnProperty(fields[0])) {
      lut[fields[0]] = {
        v1: [], v2: [], def: []
      };
    }
    lut[fields[0]].v1.push(fields[2]);
    lut[fields[0]].v2.push(fields[1]);
    lut[fields[0]].def.push(fields[3]);
  })
  .on('close', function() {
    console.error('loaded v2v1 lut');
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
        lut[gene._id].v1.forEach(id => {
          if (id != '-') {
            gene.synonyms.push(id);
          }
        });
        lut[gene._id].v2.forEach(id => {
          if (id != '-') {
            gene.synonyms.push(id);
          }
        });
        gene.synonyms = _.uniq(gene.synonyms);
        var v2descriptions = [];
        lut[gene._id].def.forEach(v2description => {
          if (v2description != '-') {
            v2descriptions.push(v2description);
          }
        });
        if (v2descriptions.length > 0) {
          gene.description = v2descriptions[0];
        }
      }
      that.push(gene);
      done();
    });
  });
}


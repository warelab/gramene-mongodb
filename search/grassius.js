#!/usr/bin/env node
var Q = require('q');
var through2 = require('through2');
var _ = require('lodash');

function getMapping() {
  var deferred = Q.defer();
  var lut = {};
  var filename = 'grassius.tsv';
  console.error('grassius');
  require('readline').createInterface({
    input: require('fs').createReadStream(filename),
    terminal: false
  })
  .on('line', function(line) {
    var fields = line.split("\t");
    /*
      fields are
  0  ensembl id
  1  gene name
  2  Grassius family
    */
    if (!lut.hasOwnProperty(fields[0])) {
      lut[fields[0]] = {
        name: new Set([fields[1]]),
        family: new Set([fields[2]])
      };
    } else {
      lut[fields[0]].name.add(fields[1]);
      lut[fields[0]].family.add(fields[2]);
    }
  })
  .on('close', function() {
    console.error('loaded grassius lut');
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
        lut[gene._id].name.forEach(syn => {
          gene.synonyms.push(syn)
        });
        gene.synonyms = _.uniq(gene.synonyms);
        // add xref
        if (!gene.hasOwnProperty('xrefs')) {
          gene.xrefs = [];
        }
        gene.xrefs.push({
          db: 'Grassius',
          ids: [...lut[gene._id].family]
        });
      }
      that.push(gene);
      done();
    });
  });
}


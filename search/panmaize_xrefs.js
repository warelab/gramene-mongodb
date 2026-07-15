#!/usr/bin/env node
var Q = require('q');
var through2 = require('through2');
var _ = require('lodash');

function getMapping() {
  var deferred = Q.defer();
  var lut = {};
  var filename = 'gene_id.pan_set_id.txt';
  console.error('Pan-Zea pan set ids');
  require('readline').createInterface({
    input: require('fs').createReadStream(filename),
    terminal: false
  })
  .on('line', function(line) {
    var fields = line.split("\t");
    /*
      fields are
  0  ensembl id
  1  pan set id
    */
    if (!lut.hasOwnProperty(fields[0])) {
      lut[fields[0]] = [];
    }
    lut[fields[0]].push(fields[1]);
  })
  .on('close', function() {
    console.error('loaded PanZea lut');
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
        // pan-gene set ids are alternate ids, not synonyms
        if (!gene.hasOwnProperty('alt_id')) {
          gene.alt_id = [];
        }
        lut[gene._id].forEach(syn => {
          gene.alt_id.push(syn)
        });
        gene.alt_id = _.uniq(gene.alt_id);
        // add xref
        if (!gene.hasOwnProperty('xrefs')) {
          gene.xrefs = [];
        }
        gene.xrefs.push({
          db: 'Pan-Zea',
          ids: lut[gene._id]
        });
      }
      that.push(gene);
      done();
    });
  });
}


#!/usr/bin/env node
var Q = require('q');
var through2 = require('through2');
var _ = require('lodash');

function getMapping() {
  var deferred = Q.defer();
  var lut = {};
  var filename = 'geneIDhistory.v3TOv4.txt.full_info.oct2016.name.description';
  console.error('fixMaizeV4 getMapping');
  require('readline').createInterface({
    input: require('fs').createReadStream(filename),
    terminal: false
  })
  .on('line', function(line) {
    var fields = line.split("\t");
    /*
      fields are
  0  v3 id
  1  v4 id
  2  a
  3  b
  4  c
  5  v3 name
  6  v3 description
    */
    if (lut.hasOwnProperty(fields[1])) {
      lut[fields[1]].v3.push(fields[0]);
      lut[fields[1]].names.push(fields[5]);
      lut[fields[1]].descriptions.push(fields[6]);
    }
    else {
      lut[fields[1]] = {v3:[fields[0]], names:[fields[5]], descriptions:[fields[6]]};
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
        // merge with gene.synonyms
        if (!gene.hasOwnProperty('synonyms')) {
          gene.synonyms = [];
        }
        lut[gene._id].v3.forEach(id => {
          if (id != '-') {
            gene.synonyms.push(id);
          }
        });
        var v3names = [];
        lut[gene._id].names.forEach(v3name => {
          if (v3name != '-') {
            gene.synonyms.push(v3name);
            v3names.push(v3name);
          }
        });
        if (gene.name == gene._id && v3names.length == 1) {
          gene.name = v3names[0];
        }
        gene.synonyms = _.uniq(gene.synonyms);
        var v3descriptions = [];
        lut[gene._id].descriptions.forEach(v3description => {
          if (v3description != '-' && !v3description.match(/Uncharacterized protein/)) {
            v3descriptions.push(v3description);
          }
        });
        if (!gene.description && v3descriptions.length == 1) {
          gene.description = v3descriptions[0];
        }
      }
      that.push(gene);
      done();
    });
  });
}


#!/usr/bin/env node
var Q = require('q');
var through2 = require('through2');
var _ = require('lodash');

function getMapping() {
  var deferred = Q.defer();
  var lut = {};
  var filename = 'maizegdb_genes_all.txt';
  console.error('maizegdb getMapping');
  require('readline').createInterface({
    input: require('fs').createReadStream(filename),
    terminal: false
  })
  .on('line', function(line) {
    var fields = line.split("\t");
    /*
      fields are
  0  v5 id
  1  v4 id
  2  v3 id
  3  symbol
  4  name
  5  source
    */
    if (lut.hasOwnProperty(fields[0])) {
      lut[fields[0]].v4.push(fields[1]);
      lut[fields[0]].v3.push(fields[2]);
      lut[fields[0]].names.push(fields[3]);
      lut[fields[0]].descriptions.push(fields[4]);
    }
    else {
      lut[fields[0]] = {
        v4:[fields[1]],
        v3:[fields[2]],
        names:[fields[3]],
        descriptions:[fields[4]],
        ids:[]
      };
    }
    if (fields[5] === "GenBank") {
      let gb_acc = lut[fields[0]].names.pop();
      lut[fields[0]].ids.push(gb_acc);
    }
  })
  .on('close', function() {
    console.error('loaded maizegdb lut');
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
        lut[gene._id].v4.forEach(id => {
          if (id != '-') {
            gene.synonyms.push(id);
          }
        });
        lut[gene._id].names.forEach(name => {
          gene.synonyms.push(name)
        });
        if (gene.name == gene._id && lut[gene._id].names.length == 1) {
          gene.name = lut[gene._id].names[0];
        }
        gene.synonyms = _.uniq(gene.synonyms);
        var descriptions = [];
        lut[gene._id].descriptions.forEach(description => {
          if (description !== '-' && !description.match(/Uncharacterized protein/)) {
            descriptions.push(description);
          }
        });
        if (!gene.description && descriptions.length == 1) {
          gene.description = descriptions[0];
        }
        if (lut[gene._id].ids.length > 0) {
          
        }
      }
			that.push(gene);
	    done();
    });
  });
}


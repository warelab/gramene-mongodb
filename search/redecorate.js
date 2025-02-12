#!/usr/bin/env node

var fs = require('fs'),
byline = require('byline'),
_ = require('lodash'),
through2 = require('through2');

var collections = require('gramene-mongodb-config');
var argv = require('minimist')(process.argv.slice(2));

var curated = require('./curated')();
var reader = byline(fs.createReadStream(argv.i));
var writer = fs.createWriteStream(argv.o);
var parser = through2.obj(function (line, enc, done) {
  this.push(JSON.parse(line));
  done();
});


var numberDecorated=0;
var serializer = through2.obj(function (obj, enc, done) {
  this.push(JSON.stringify(obj) + "\n");
  numberDecorated++;
  if (numberDecorated % 1000 === 0) {
    console.error('decorated '+numberDecorated+' genes');
  }
  done();
});

var speciesRank = {
  sorghum_bicolor : 3, // sorghum
  arabidopsis_thaliana : 2, // arabidopsis
  oryza_sativa: 1, // rice
  zea_maysb73 : 4  // maize
};
 
var speciesRanker = through2.obj(function (obj, enc, done) {
  obj.species_idx = speciesRank[obj.system_name] || Math.floor(obj.taxon_id/1000);
  this.push(obj);
  done();
});


var cleanup = through2.obj(function (gene, enc, done) {
  function removeEmpties(obj) {
    for (var k in obj) {
      if (obj[k] && typeof(obj[k]) === 'object') {
        if (Object.keys(obj[k]).length === 0) {
          delete obj[k];
        }
        else if (!Array.isArray(obj[k])) {
          removeEmpties(obj[k]);
        }
      }
      else if (obj[k] === '') {
        delete obj[k];
      }
    }
  }
  removeEmpties(gene);
  this.push(gene);
  done();
});

var stream = reader.pipe(parser)
  // .pipe(curated)
  .pipe(speciesRanker)
  .pipe(cleanup)
  .pipe(serializer)
  .pipe(writer);

writer.on('finish', function() {
  process.exit(0);
});

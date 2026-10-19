#!/usr/bin/env node

var fs = require('fs'),
byline = require('byline'),
_ = require('lodash'),
through2 = require('through2');

var collections = require('gramene-mongodb-config');
var argv = require('minimist')(process.argv.slice(2));

var binAdder = require('./bin_adder')({fixed:[100,200,500,1000],uniform:[1,2,5,10]});
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

// species ordering now lives in ./species_rank.js -- decorate.js and redecorate.js used to carry
// separate, conflicting copies of this map and of the fallback.
var rankFor = require('./species_rank').rankFor;

var speciesRanker = through2.obj(function (obj, enc, done) {
  obj.species_idx = rankFor(obj);
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
  // .pipe(speciesRanker)
  .pipe(binAdder)
  .pipe(cleanup)
  .pipe(serializer)
  .pipe(writer);

writer.on('finish', function() {
  process.exit(0);
});

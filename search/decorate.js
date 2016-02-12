#!/usr/bin/env node

var fs = require('fs'),
byline = require('byline'),
through2 = require('through2');

var argv = require('minimist')(process.argv.slice(2));

var reader = byline(fs.createReadStream(argv.i));
var writer = fs.createWriteStream(argv.o);
var binAdder = require('./bin_adder')({fixed:[100,200,500,1000],uniform:[1,2,5,10]});
var pathwayAdder = require('./pathway_adder')(argv.p);
var genetreeAdder = require('./genetree_adder')(argv.d);
var homologAdder = require('./homolog_adder')(1);
var domainArchitect = require('./domain_architect')();
var ancestorAdder = require('./ancestor_adder')();
var parser = through2.obj(function (line, enc, done) {
  this.push(JSON.parse(line));
  done();
});


var serializer = through2.obj(function (gene, enc, done) {
  this.push(JSON.stringify(gene) + "\n");
  done();
});

reader
.pipe(parser)
.pipe(genetreeAdder)
.pipe(binAdder)
.pipe(pathwayAdder)
.pipe(homologAdder)
.pipe(domainArchitect)
.pipe(ancestorAdder)
.pipe(serializer)
.pipe(writer);

writer.on('finish', () => {
  process.exit(0);
});
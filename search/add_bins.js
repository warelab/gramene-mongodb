#!/usr/bin/env node
// load the ordered set of maps
// create binMappers for various binning options
// 1. uniform width bins of 1Mb, 2Mb, 5Mb, 10Mb, etc
// 2. arbitrary precalculated sets of bins such as gene_space_100
// iterate over gene documents and add bin fields to each document
// based on the 5' end of the gene? or make bin fields multi-valued so genes
// can span multiple bins?

var genomes_file = process.argv[2];
var genes_file = process.argv[3];

var fs = require('fs');
var genomes = JSON.parse(fs.readFileSync(genomes_file, 'utf8'));

var bins = require('../maps/bins.js')(genomes);

var mapper = {
  bin_1Mb: bins.binMapper(1000000),
  bin_2Mb: bins.binMapper(2000000),
  bin_5Mb: bins.binMapper(5000000),
  bin_10Mb: bins.binMapper(10000000)
};

// read genes documents
require('readline').createInterface(
  {
    input: fs.createReadStream(genes_file),
    terminal: false
  }
).on('line', function(line) { // one JSON object per line
   var gene = JSON.parse(line);
   var tss = gene.location.strand === 1 ? gene.location.start : gene.location.end;
   for(var field in mapper) {
     var bin = mapper[field].pos2bin(gene.taxon_id, gene.location.region, tss);
     gene[field] = bin;
   }
   console.log(JSON.stringify(gene));
});
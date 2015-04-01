#!/usr/bin/env node
// load the ordered set of maps
// create binMappers for various binning options
// 1. uniform width bins of 1Mb, 2Mb, 5Mb, 10Mb, etc
// 2. fixed number of bins per genome 100, 200, 500, 1000
// iterate over gene documents and add bin fields to each document
// based on the TSS of the gene

var genomes_file = process.argv[2];
var genes_file = process.argv[3];

var fs = require('fs');
var genomes = JSON.parse(fs.readFileSync(genomes_file, 'utf8'));

var binsGenerator = require('gramene-bins-client');
var bins = binsGenerator.bins(genomes);

var mapper = {
  fixed_100_bin : bins.fixedBinMapper( 100), // 100 bins per genome
  fixed_200_bin : bins.fixedBinMapper( 200),
  fixed_500_bin : bins.fixedBinMapper( 500),
  fixed_1000_bin: bins.fixedBinMapper(1000), // 1000 bins per genome
  uniform_1Mb_bin : bins.uniformBinMapper( 1000000), // all bins are 1Mb
  uniform_2Mb_bin : bins.uniformBinMapper( 2000000),
  uniform_5Mb_bin : bins.uniformBinMapper( 5000000),
  uniform_10Mb_bin: bins.uniformBinMapper(10000000)  // all bins are 10Mb
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
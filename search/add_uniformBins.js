#!/usr/bin/env node
// read the bin lookup table produced by build_bin_lut.js into memory
// iterate over gene documents and add bin fields to each document
// based on the 5' end of the gene
var lut_file = process.argv[2];
var genes_file = process.argv[3];

var fs = require('fs');
var bin_lut = JSON.parse(fs.readFileSync(lut_file, 'utf8'));
// read genes documents
require('readline').createInterface(
  {
    input: fs.createReadStream(genes_file),
    terminal: false
  }
).on('line', function(line) { // one JSON object per line
   var gene = JSON.parse(line);
   var tss = gene.location.strand === 1 ? gene.location.start : gene.location.end;
   for (var mb in bin_lut) {
     if (bin_lut[mb][gene.taxon_id].hasOwnProperty(gene.location.region)) {
       gene['bin_'+mb+'Mb'] = bin_lut[mb][gene.taxon_id][gene.location.region].o + Math.floor(tss/(mb*1000000));
     }
     else { // unanchored
       gene['bin_'+mb+'Mb'] = bin_lut[mb][gene.taxon_id]['UNANCHORED'].o;
     }
   }
   console.log(JSON.stringify(gene));
});
#!/usr/bin/env node
var iterations = +process.argv[2];

var genomeBins = require('./genomeBins.js');

var t0 = process.hrtime();
var bin_lut = require('./bin_lut.json');
var diff = process.hrtime(t0);
var ms = diff[0]*1e3 + diff[1]/1e6;
console.log('reading lut took '+ ms + ' ms');

t0 = process.hrtime();
var gbLUT = genomeBins(bin_lut);
var diff = process.hrtime(t0);
var ms = diff[0]*1e3 + diff[1]/1e6;
console.log('initialization took '+ ms + ' ms');

bin_lut.sizes.forEach(function(mb) {
  nbins = gbLUT.nbins(mb);
  t0 = process.hrtime();
  for (var i=0; i<iterations; i++) {
    var bin = Math.floor(Math.random()*nbins);
    var gpos = gbLUT.binToGenome(mb,bin);
    var startBin = gbLUT.genomeToBin(mb,gpos.taxon,gpos.region,gpos.start);
    var endBin = gbLUT.genomeToBin(mb,gpos.taxon,gpos.region,gpos.end-1);
    var midBin = gbLUT.genomeToBin(mb,gpos.taxon,gpos.region,gpos.start + Math.floor((gpos.end-gpos.start)/2));
    if (bin != startBin || bin != endBin || bin != midBin) {
      console.log(bin,startBin,midBin,endBin,gpos);
    }
  }
  diff = process.hrtime(t0);
  ms = diff[0]*1e3 + diff[1]/1e6;
  console.log(mb+'mb ('+nbins+' bins): '+iterations+' iterations took '+ ms + ' ms');
});

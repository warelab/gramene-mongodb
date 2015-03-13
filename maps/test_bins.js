#!/usr/bin/env node
var iterations = +process.argv[2];


var t0 = process.hrtime();
var maps = require('./maps.json');
var diff = process.hrtime(t0);
var ms = diff[0]*1e3 + diff[1]/1e6;
console.log('reading maps.json took '+ ms + ' ms');

t0 = process.hrtime();
var bins = require('./bins.js')(maps);

var mapper_2Mb = bins.binMapper('uniform',2000000);
var mapper_200_per_genome = bins.binMapper('fixed',200);
// lets try some homemade bins
var mybins = [
  {taxon_id:3702,region:"1",start:123,end:432},
  {taxon_id:3702,region:"1",start:555,end:888},
  {taxon_id:3702,region:"2",start:111,end:444}
];
var custom_mapper = bins.binMapper(mybins);

var diff = process.hrtime(t0);
var ms = diff[0]*1e3 + diff[1]/1e6;
console.log('initialization took '+ ms + ' ms');

nbins = mapper_2Mb.nbins;
t0 = process.hrtime();
for (var i=0; i<iterations; i++) {
  var bin = Math.floor(Math.random()*nbins);
  var gpos = mapper_2Mb.bin2pos(bin);
  // var gpos = binner2Mb._binPos[bin];
  var startBin = mapper_2Mb.pos2bin(gpos.taxon_id,gpos.region,gpos.start);
  var endBin = mapper_2Mb.pos2bin(gpos.taxon_id,gpos.region,gpos.end-1);
  var midBin = mapper_2Mb.pos2bin(gpos.taxon_id,gpos.region,gpos.start + Math.floor((gpos.end-gpos.start)/2));
  if (bin != startBin || bin != endBin || bin != midBin) {
    console.log(bin,startBin,midBin,endBin,gpos);
  }
}
diff = process.hrtime(t0);
ms = diff[0]*1e3 + diff[1]/1e6;
console.log(nbins+' bins: '+iterations+' iterations took '+ ms + ' ms');



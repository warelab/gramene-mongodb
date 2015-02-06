#!/usr/bin/env node

var MongoClient = require('mongodb').MongoClient;
    fs          = require('fs');
var sizes = process.argv.slice(2);

var bin_lut = {},
    bin_idx = {},
    bin_nts = {};

sizes.forEach(function(mb) {
  bin_idx[mb] = 0;
  bin_nts[mb] = mb*1000000;
});

MongoClient.connect('mongodb://127.0.0.1:27017/cmap', function(err, cmapdb) {
  if (err) throw err;
  var maps = cmapdb.collection("maps");
  // retrieve the maps sorted by taxonomy id
  maps.find({type:'genome'}, {}).sort({'taxon_id' : 1}).toArray(function(err, genomes) {
    if (err) throw err;
    genomes.forEach(function(map) {
      bin_lut[map.taxon_id] = {};
      // iterate over the regions in the order provided
      // update genes in the region.
      for(var i=0;i<map.regions.names.length;i++) {
        var region = map.regions.names[i];
        var rlength = map.regions.lengths[i];
        bin_lut[map.taxon_id][region] = {l:rlength,b:[]};
        sizes.forEach(function(mb) {
          bin_lut[map.taxon_id][region].b.push(bin_idx[mb]);
          if (region === 'UNANCHORED') {
            bin_idx[mb]++;
          }
          else {
            bin_idx[mb] += Math.ceil(rlength / bin_nts[mb]);
          }
        });
      }
    });
    cmapdb.close();
    fs.writeFileSync('bin_lut.json',JSON.stringify({sizes:sizes,lut:bin_lut}));
  });
});
#!/usr/bin/env node
// load the ordered set of maps
// create binMappers for various binning options
// 1. uniform width bins of 1Mb, 2Mb, 5Mb, 10Mb, etc
// 2. fixed number of bins per genome 100, 200, 500, 1000
// iterate over gene documents and add bin fields to each document
// based on the TSS of the gene

var maps = require('../config/collections.js').maps;
var mongoURL = 'mongodb://'
  + maps.host + ':' + maps.port + '/' + maps.dbName;
var MongoClient = require('mongodb').MongoClient;
MongoClient.connect(mongoURL, function(err, db) {
  if (err) throw err;
  // fetch all the genome maps and build a binsGenerator
  var coll = db.collection(maps.collectionName);
  coll.find({type:'genome'}, {}).toArray(function(err, genomes) {
    if (err) throw err;
    db.close();
    var binsGenerator = require('gramene-bins-client');
    var bins = binsGenerator.bins(genomes);

    var mapper = {
      fixed_100 : bins.fixedBinMapper( 100), // 100 bins per genome
      fixed_200 : bins.fixedBinMapper( 200),
      fixed_500 : bins.fixedBinMapper( 500),
      fixed_1000: bins.fixedBinMapper(1000), // 1000 bins per genome
      uniform_1Mb : bins.uniformBinMapper( 1000000), // all bins are 1Mb
      uniform_2Mb : bins.uniformBinMapper( 2000000),
      uniform_5Mb : bins.uniformBinMapper( 5000000),
      uniform_10Mb: bins.uniformBinMapper(10000000)  // all bins are 10Mb
    };

    // read genes documents
    require('readline').createInterface(
      {
        input: process.stdin,
        terminal: false
      }
    ).on('line', function(line) { // one JSON object per line
       var gene = JSON.parse(line);
       gene.bins = {};
       for(var field in mapper) {
         var bin = mapper[field].pos2bin(gene.taxon_id, gene.location.region, gene.location.start);
         gene.bins[field] = bin;
       }
       console.log(JSON.stringify(gene));
    });
  });
});
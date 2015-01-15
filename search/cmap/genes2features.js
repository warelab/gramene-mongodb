// for each species, retrieve the regions.names array from the cmap.maps collection

var MongoClient = require('mongodb').MongoClient;
var async = require('async');
var fs = require('fs');
var mkdirp = require('mkdirp');
var exec = require('child_process').exec;
var outputDir = process.argv[2];

// Functor necessary for variable closure
function findFunctor(genes,map,region) {
  "use strict";
  return function (done) {
    if (region !== "UNANCHORED") {
      console.log('searching for genes in map '+map._id+' on seq_region '+region);
      genes.find({'location.map':map._id,'location.region':region},{fields:{location:1}})
      .sort({'location.start' : 1}).toArray(function(err, result) {
        if (err) throw err;
        done(null, result);
      });
    }
    else {
      // find the unanchored regions
      console.log('searching for genes in map '+map._id+' on unanchored seq_regions');
      var query = {'location.map':map._id};
      if (map.regions.names.length > 1) {
        query['location.region'] = {$nin : map.regions.names};
      }
      genes.find(query,{fields:{location:1}})
      .sort({'location.region':1,'location.start' : 1}).toArray(function(err, result) {
        if (err) throw err;
        done(null, result);
      });
    }
  };
}

// connect to the cmapdb to get the maps
var mongoURL = 'mongodb://127.0.0.1:27017/';
MongoClient.connect(mongoURL + 'search44', function(err, searchdb) {
  if (err) throw err;
  var genes = searchdb.collection("genes");
  MongoClient.connect(mongoURL + 'cmap', function(err, cmapdb) {
    if (err) throw err;
    var maps = cmapdb.collection("maps");
    maps.find({}, {}).toArray(function(err, result) {
      if (err) throw err;
      var funcs = [];
      var mapOffsets = [];
      var system_name = [];
      result.forEach(function(map) {
        // get genes annotated on this map;
        // iterate over the regions so we don't have to sort the genes
        system_name[map._id] = map.system_name;
        mapOffsets[map._id]=[];
        mapOffset=0;
        for (var i in map.regions.names) {          
          funcs.push(findFunctor(genes,map,map.regions.names[i]));
          mapOffsets[map._id][map.regions.names[i]] = mapOffset;
          mapOffset += map.regions.lengths[i];
        }
      });
      // run funcs (serially)
      async.series(funcs, function(err,sortedGenes) {
        if (err) throw err;
        var featureSet = {};
        var gene_idx = 1;
        sortedGenes.forEach(function(byRegion) {
          if (byRegion && byRegion[0]) {
            var map = byRegion[0].location.map;
            if (!featureSet.hasOwnProperty(map)) {
              featureSet[map] = {
                name : 'genes',
                type : 'gene',
                map : map,
                count : 0,
                counts : [],
                features : []
              };
              gene_idx=1;
            }
            featureSet[map].counts.push(byRegion.length);
            featureSet[map].count += byRegion.length;
            byRegion.forEach(function(gene) {
              // write features output file for this map
              var feature = {
                id: gene._id,
                gene_idx : gene_idx,
                region : gene.location.region,
                start : gene.location.start,
                end : gene.location.end,
                strand : gene.location.strand
              };
              if (mapOffsets[map].hasOwnProperty(gene.location.region)) {
                feature.genome_idx = gene.location.start + mapOffsets[map][gene.location.region];
              }
              else { // unanchored scaffold - order of genes is undefined
                feature.genome_idx = 0;
              }
              featureSet[map].features.push(feature);
              gene_idx++;
            });
          }
        });
        // output the features documents
        var batch = genes.initializeOrderedBulkOp();
        for (var map in featureSet) {
          // output the features to fastbit
          // system_name/map/featureSet.name
          var outdir = outputDir+'/'+system_name[map]+'/'+map;
          mkdirp.sync(outdir);
          var fb_dir = outdir+'/'+featureSet[map].name;
          var csv_buffer='';
          featureSet[map].features.forEach(function(feature) {
            var csv = [
              feature.id,
              feature.gene_idx,
              feature.genome_idx,
              feature.region,
              feature.start,
              feature.end,
              feature.strand
            ].join(',');
            csv_buffer += csv+'\n';
            batch.find({_id:feature.id})
              .updateOne({$set:{gene_idx:feature.gene_idx,genome_idx:feature.genome_idx}});
          });
          fs.writeFileSync(fb_dir+'.csv', csv_buffer);
          // run ardea here to set up fastbit
          var fb_cmd = 'ardea -d '+fb_dir+' -t '+fb_dir+'.csv ';
          fb_cmd += '-m id:t,gene_idx:i,genome_idx:l,region:k,start:i,end:i,strand:i -tag map='+map;
          fb_cmd += '; rm '+fb_dir+'.csv';
          console.log('indexing '+fb_dir);
          var ardea = exec(fb_cmd, function (error, stdout, stderr) {
            if (error) throw error;
            console.log(stdout.split('\n')[8]);
          });
          delete featureSet[map].features;
          fs.appendFileSync('features.json',JSON.stringify(featureSet[map])+'\n');
        }
        cmapdb.close();
        console.log('executing batch updates');
        batch.execute(function(err,result) {
          if (err) throw err;
          console.log('DONE! '+result.nUpserted);
          searchdb.close();
        });
      });
    });
  });
});
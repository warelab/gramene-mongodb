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

var mongoURL = 'mongodb://127.0.0.1:27017/';
MongoClient.connect(mongoURL + 'search44', function(err, searchdb) {
  if (err) throw err;
  var genes = searchdb.collection("genes");
  MongoClient.connect(mongoURL + 'cmap', function(err, cmapdb) {
    if (err) throw err;
    var maps = cmapdb.collection("maps");
    // retrieve the maps sorted by taxonomy id
    maps.find({}, {}).sort({'taxon_id' : 1}).toArray(function(err, result) {
      if (err) throw err;
      var funcs = [];
      var mapOffsets = [];
      result.forEach(function(map) {
        // get genes annotated on this map;
        // iterate over the regions in the order provided
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
        var gene_idx = 0;
        sortedGenes.forEach(function(byRegion) {
          if (byRegion && byRegion[0]) {
            var map_id = byRegion[0].location.map;
            if (!featureSet.hasOwnProperty(map_id)) {
              featureSet[map_id] = {
                name : 'genes',
                type : 'gene',
                map : map_id,
                count : 0,
                counts : [],
                features : []
              };
              gene_idx=0;
            }
            featureSet[map_id].counts.push(byRegion.length);
            featureSet[map_id].count += byRegion.length;
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
              if (mapOffsets[map_id].hasOwnProperty(gene.location.region)) {
                feature.genome_idx = gene.location.start + mapOffsets[map_id][gene.location.region];
              }
              else { // unanchored scaffold - order of genes is undefined here
                feature.genome_idx = 0;
              }
              featureSet[map_id].features.push(feature);
              gene_idx++;
            });
          }
        });
        // create bins for faster facet.field genomic and gene space distributions
        // the first bin in each genome is for genes on unanchored regions
        var genome_1000=0; // the current bin (1000 per genome)
        var genome_100=0; // the current bin (100 per genome)
        var gene_1000=0; // the current gene space bin (1000 per genome)
        var gene_100=0; // the current gene space bin (100 per genome)
        // actually, since we want to split bins that would cross chromosome boundaries
        // there will be 1000 + k bins (including the one for unanchored regions)

        // the bin_maps object tells you how genomes and chromosomes map to bins
        // top level keys are the solr field names for the binned fields
        // second level keys are taxon_ids
        // third level keys are pseudomolecules or the unanchored
        // each has keys for first and last bin
        var bin_maps = {genome_1000:{},genome_100:{},gene_1000:{},gene_100:{}};
        var first_bin = true;

        var batch = genes.initializeOrderedBulkOp();
        // iterate over the maps in order again.
        result.forEach(function(map) {
          // consult featureSet[map].counts and map.regions to determine bin boundaries
          var genome_1000_binsize = map.length/1000;
          var genome_100_binsize = map.length/100;
          var gene_1000_binsize = featureSet[map._id].count/1000;
          var gene_100_binsize = featureSet[map._id].count/100;
          var genome_1000_binend = genome_1000_binsize;
          var genome_100_binend = genome_100_binsize;
          var gene_1000_binend = gene_1000_binsize;
          var gene_100_binend = gene_100_binsize;
          var gene_i=0;
          bin_maps['genome_1000'][map.taxon_id] = {};
          bin_maps['genome_100'][map.taxon_id] = {};
          bin_maps['gene_1000'][map.taxon_id] = {};
          bin_maps['gene_100'][map.taxon_id] = {};
          // output the features to fastbit
          // system_name/map/featureSet.name
          var outdir = outputDir+'/'+maps.system_name+'/'+map._id;
          mkdirp.sync(outdir);
          var fb_dir = outdir+'/'+featureSet[map._id].name;
          var csv_buffer='';
          var in_un_chr = false;
          var curr_region = 'unlikely name for a chromosome';
          featureSet[map._id].features.forEach(function(feature) {
            if (feature.genome_idx === 0) {
              // we are in the unanchored bin
              if (!in_un_chr) { // first gene in the unanchored bin
                in_un_chr = true;
                if (first_bin) {
                  first_bin = false;
                }
                else {
                  genome_1000++; genome_100++;
                  gene_1000++; gene_100++;
                }
                curr_region = 'UNANCHORED';
                bin_maps['genome_1000'][map.taxon_id][curr_region] = {start:genome_1000};
                bin_maps['genome_100'][map.taxon_id][curr_region] = {start:genome_100};
                bin_maps['gene_1000'][map.taxon_id][curr_region] = {start:gene_1000};
                bin_maps['gene_100'][map.taxon_id][curr_region] = {start:gene_100};
                gene_1000_binend += gene_1000_binsize;
                gene_100_binend += gene_100_binsize;
                gene_i=0;
              }
            }
            else {
              // we are in an assembled top level pseudomolecule
              if (feature.region !== curr_region) {
                curr_region = feature.region;
                if (first_bin) {
                  first_bin = false;
                }
                else {
                  genome_1000++; genome_100++;
                  gene_1000++; gene_100++;
                }
                bin_maps['genome_1000'][map.taxon_id][curr_region] = {start:genome_1000};
                bin_maps['genome_100'][map.taxon_id][curr_region] = {start:genome_100};
                bin_maps['gene_1000'][map.taxon_id][curr_region] = {start:gene_1000};
                bin_maps['gene_100'][map.taxon_id][curr_region] = {start:gene_100};
                genome_1000_binend = genome_1000_binsize;
                genome_100_binend = genome_100_binsize;
                gene_1000_binend += gene_1000_binsize;
                gene_100_binend += gene_100_binsize;
                gene_i=0;
                prev_region = feature.region;
              }
              while (feature.start >= genome_1000_binend) { // dislike
                genome_1000++;
                genome_1000_binend += genome_1000_binsize;
              }
              while (feature.start >= genome_100_binend) { // dislike
                genome_100++;
                genome_100_binend += genome_100_binsize;
              }
            }
            feature.genome_1000 = genome_1000;
            feature.genome_100 = genome_100;
            if (gene_i >= gene_1000_binend) {
              gene_1000++;
              gene_1000_binend += gene_1000_binsize;
            }
            if (gene_i >= gene_100_binend) {
              gene_100++;
              gene_100_binend += gene_100_binsize;
            }
            feature.gene_1000 = gene_1000;
            feature.gene_100 = gene_100;
            bin_maps['genome_1000'][map.taxon_id][curr_region].end = genome_1000;
            bin_maps['genome_100'][map.taxon_id][curr_region].end = genome_100;
            bin_maps['gene_1000'][map.taxon_id][curr_region].end = gene_1000;
            bin_maps['gene_100'][map.taxon_id][curr_region].end = gene_100;
            gene_i++;
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
              .updateOne({$set:{
                gene_idx:feature.gene_idx,
                genome_idx:feature.genome_idx,
                genome_1000:feature.genome_1000,
                genome_100:feature.genome_100,
                gene_1000:feature.gene_1000,
                gene_100:feature.gene_100,
              }});
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
          delete featureSet[map._id].features;
          fs.appendFileSync('features.json',JSON.stringify(featureSet[map._id])+'\n');
        });
        fs.writeFileSync('bin_maps.json',JSON.stringify(bin_maps));
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
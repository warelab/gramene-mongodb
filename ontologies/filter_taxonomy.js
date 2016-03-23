#!/usr/bin/env node
var collections = require('gramene-mongodb-config');
var mysql = require('mysql');
var argv = require('minimist')(process.argv.slice(2));

var comparaMysqlDb = mysql.createConnection({
  "host": argv.h,
  "user": argv.u,
  "password": argv.p,
  "database": argv.compara
});

var panComparaMysqlDb = mysql.createConnection({
  "host": argv.h,
  "user": argv.u,
  "password": argv.p,
  "database": argv.pan
});

// get the subsets of taxon_ids we care about
var subsets = {
  gramene: {},
  compara: {},
  pan_compara: {}
};

collections.maps.mongoCollection().then(function (coll) {
  coll.find({type: 'genome'}, {}).toArray(function (err, genomes) {
    if (err) throw err;
    collections.closeMongoDatabase();
    var system_name = {};
    genomes.forEach(function(g) {
      subsets.gramene[g.taxon_id] = g.num_genes;
      system_name[g.taxon_id] = g.system_name;
    });
    var query = 'select taxon_id from genome_db';
    comparaMysqlDb.query(query, function(err, rows, fields) {
      if (err) throw err;
      rows.forEach(function(row) {
        subsets.compara[row.taxon_id] = 1;
      });
      comparaMysqlDb.end();
      
      panComparaMysqlDb.query(query, function(err, rows, fields) {
        if (err) throw err;
        rows.forEach(function(row) {
          subsets.pan_compara[row.taxon_id] = 1;
        });
        panComparaMysqlDb.end();
        filterTaxonomy(subsets,system_name);
      });
    });
  });
});

function filterTaxonomy(subsets,system_name) {
  // _id of desired taxonomy nodes
  var desired = {};
  for (var subset in subsets) {
    for (var taxon in subsets[subset]) {
      desired[taxon] = desired[taxon] || {};
      desired[taxon][subset]=1;
    }
  }
  // tally of gramene genes
  var nGenes = {};
  // read the taxonomy docs into memory
  var all = {}; // indexed by _id
  require('readline').createInterface({
    input: require('fs').createReadStream(argv.taxonomy),
    terminal: false
  })
  .on('line', function (line) { // one JSON object per line
    var tax_node = JSON.parse(line);
    if (desired.hasOwnProperty(tax_node._id)) {
      var doCount = !!subsets.gramene[tax_node._id];
      if (doCount) {
        tax_node.system_name = system_name[tax_node._id];
      }
      tax_node.ancestors.forEach(function(id) {
        if (!desired.hasOwnProperty(id)) {
          desired[id] = {};
        }
        if (id !== tax_node._id) {
          for(ss in desired[tax_node._id]) {
            desired[id][ss]=1;
          }
        }
        if (doCount) {
          if (!nGenes.hasOwnProperty(id)) {
            nGenes[id] = 0;
          }
          nGenes[id] += subsets.gramene[tax_node._id];
        }
      });
    }
    all[tax_node._id] = tax_node;
  })
  .on('close', function() {
    for (var id in desired) {
      var taxNode = all[id];
      taxNode.num_genes = nGenes[id] || 0;
      taxNode.subset = Object.keys(desired[id]);
      console.log(JSON.stringify(taxNode));
    }
  });
}

#!/usr/bin/env node
var collections = require('gramene-mongodb-config');
var mysql = require('mysql');
var argv = require('minimist')(process.argv.slice(2));
var fosterParent = argv.f;
var _ = require('lodash');
var compara = require('../ensembl_db_info.json').compara;
var comparaMysqlDb = mysql.createConnection(compara);
if (argv.pan) {
  console.error('got pan db',argv.pan);
  var pan = _.cloneDeep(compara);
  pan.database = argv.pan;
  var panComparaMysqlDb = mysql.createConnection(pan);
}

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
    var taxon_lut = {};
    var customChildren = {};
    genomes.forEach(function(g) {
      taxon_lut[g.system_name] = g.taxon_id;
      subsets.gramene[g.taxon_id] = 1;
    });
    var query = 'select name,taxon_id from genome_db where taxon_id is not NULL';
    comparaMysqlDb.query(query, function(err, rows, fields) {
      if (err) throw err;
      rows.forEach(function(row) {
        subsets.compara[row.taxon_id] = 1;
        if (taxon_lut[row.name] && taxon_lut[row.name] !== row.taxon_id) {
          subsets.compara[taxon_lut[row.name]] = 1;
          subsets.gramene[row.taxon_id] = 1;
          if (!customChildren.hasOwnProperty(row.taxon_id)) {
            customChildren[row.taxon_id] = [];
          }
          customChildren[row.taxon_id].push(taxon_lut[row.name]);
        }
      });
      comparaMysqlDb.end();
      
      if (panComparaMysqlDb) {
        panComparaMysqlDb.query(query, function(err, rows, fields) {
          if (err) throw err;
          rows.forEach(function(row) {
            subsets.pan_compara[row.taxon_id] = 1;
            if (taxon_lut[row.name] && taxon_lut[row.name] !== row.taxon_id) {
              subsets.pan_compara[taxon_lut[row.name]] = 1;
            }
          });
          panComparaMysqlDb.end();
          filterTaxonomy(subsets, genomes, customChildren);
        });
      }
      else {
        filterTaxonomy(subsets, genomes, customChildren);
      }
    });
  });
});

function filterTaxonomy(subsets,genomes,customChildren) {
  // tally of gramene genes
  var nGenes = {};
  var genome_idx = {};
  genomes.forEach(function(g) {
    genome_idx[g.taxon_id] = g;
    nGenes[g.taxon_id] = g.num_genes;
  });
  for (var id in customChildren) {
    nGenes[id]=0;
    customChildren[id].forEach(function(c) {
      nGenes[id] += nGenes[c];
    });
  }
  // _id of desired taxonomy nodes
  var desired = {};
  for (var subset in subsets) {
    for (var taxon in subsets[subset]) {
      desired[taxon] = desired[taxon] || {};
      desired[taxon][subset]=1;
    }
  }
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
      tax_node.ancestors.forEach(function(id) {
        if (!desired.hasOwnProperty(id)) {
          desired[id] = {};
        }
        if (id !== tax_node._id) {
          for(ss in desired[tax_node._id]) {
            desired[id][ss]=1;
          }
          if (doCount) {
            if (!nGenes.hasOwnProperty(id)) {
              nGenes[id] = 0;
            }
            nGenes[id] += nGenes[tax_node._id];
          }
        }
      });
      if (doCount) {
        if (genome_idx[tax_node._id]) {
          tax_node.system_name = genome_idx[tax_node._id].system_name;
        }
        if (customChildren[tax_node._id]) {
          // this taxon_id should be an internal node with child nodes for the 
          // genomes
          var i=0;
          customChildren[tax_node._id].forEach(function(childId) {
            var g = genome_idx[childId];
            var map_node = _.cloneDeep(tax_node);
            map_node._id = childId;
            map_node.id = `NCBITaxon:${childId}`;
            map_node.system_name = g.system_name;
            map_node.is_a = [tax_node._id];
            map_node.name = g.display_name;
            map_node.ancestors.push(+childId); // convert to number
            all[childId] = map_node;
          });
        }
      }
    }
    all[tax_node._id] = tax_node;
  })
  .on('close', function() {
    var regex = /([0-9]*)0[0-9][0-9]$/;
    for (var id in desired) {
      var taxNode = all[id];
      if (!taxNode) {
	if (!argv.f) {
          var matches = id.toString().match(regex);
          if (matches && matches.length === 2) {
            var sib = +matches[1];
            if (all[sib]) {
              fosterParent = all[sib].is_a[0];
            }
          } else {
		console.error("no matches for ",id)
	  }
	}
	if (all[fosterParent]) {
          console.error("no taxNode for desired id",id,". adding as a foster child to id",fosterParent);
          var g = genome_idx[id];
          var fosterChild = _.cloneDeep(all[fosterParent]);
          fosterChild._id = +id;
          fosterChild.id = `NCBITaxon:${id}`;
          fosterChild.system_name = g.system_name;
          fosterChild.is_a = [fosterParent];
          fosterChild.name = g.display_name;
          fosterChild.property_value = "has_rank NCBITaxon:species";
	  if (argv.synonym) {
            fosterChild.synonym = [argv.synonym];
          }
          fosterChild.ancestors.forEach(function(a) {
            nGenes[a] += nGenes[id];
          });
          fosterChild.ancestors.push(id);
          all[id] = fosterChild;
	}
        else {
          console.error(`fosterParent ${fosterParent} is not a valid tax id for desired id ${id}`);
        }
      }
    }
    for (var id in desired) {
      var taxNode = all[id];
      taxNode.num_genes = nGenes[id] || 0;
      taxNode.subset = Object.keys(desired[id]);
      console.log(JSON.stringify(taxNode));
    }
  });
}

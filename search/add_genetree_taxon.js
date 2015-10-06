#!/usr/bin/env node
var MongoClient = require('mongodb').MongoClient,
  _ = require('lodash'),
  TreeModel = require('tree-model'),
  gtDB = require('../config/collections.js').genetrees;

var mongoURL = 'mongodb://'
  + gtDB.host + ':' + gtDB.port + '/' + gtDB.dbName;

function modifyGeneDocs(genetreeLUT) {
  require('readline').createInterface({
    input: process.stdin,
    terminal: false
  }).on('line', function (line) { // one JSON object per line
    var obj = JSON.parse(line);
    var tree = genetreeLUT[obj._id];

    if(tree) {
      obj.grm_gene_tree = tree.grm;
      obj.grm_gene_tree_root_taxon_id = tree.grm_gene_tree_root_taxon_id;
      obj.epl_gene_tree = tree.epl;
      if(tree.siblings.length > 1) {
        obj.epl_sibling_trees = _.filter(tree.siblings, function(id) { return id !== obj.epl_gene_tree; });
      }
    }
    console.log(JSON.stringify(obj));
  });
}

// connect to the ontologies database
MongoClient.connect(mongoURL, function (err, db) {
  if (err) throw err;
  db.collection(gtDB.collectionName).find().toArray(function (err, docs) {
    if (err) throw err;
    var countOfGenes = 0;

    var genetreeIdLut = docs.reduce(function (acc, doc) {
      var tree = new TreeModel().parse(doc);
      var rootTaxonId = tree.model.node_taxon_id;
      var grmTreeId = tree.model.tree_id;

      var subtrees = tree.all(function (node) {
        return !!node.model.subtree_stable_id;
      });
      var subtreeIds = subtrees.map(function(node) { return node.model.subtree_stable_id });

      if(subtrees.length == 0) {
        subtrees = [tree];
      }

      subtrees.forEach(function (subtree) {
        var eplTreeId = subtree.model.subtree_stable_id || grmTreeId;
        var lookupValue = {
          epl: eplTreeId,
          grm: grmTreeId,
          grm_gene_tree_root_taxon_id: rootTaxonId,
          siblings: subtreeIds
        };

        subtree.all(function (node) {
            return !node.hasChildren();
          })
          .map(function (leaf) {
            return leaf.model.gene_stable_id
          })
          .forEach(function (geneId) {
            acc[geneId] = lookupValue;
            ++countOfGenes;
          });
      });
      return acc;
    }, {});

    modifyGeneDocs(genetreeIdLut);
    db.close();
  });
});

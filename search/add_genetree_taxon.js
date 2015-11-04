#!/usr/bin/env node
var _ = require('lodash'),
  TreeModel = require('tree-model'),
  collections = require('gramene-mongodb-config');

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
      if (tree.hasOwnProperty('representative')) {
        obj.representative = tree.representative;
      }
    }
    console.log(JSON.stringify(obj));
  });
}

function indexTree(tree, attrs) {
  tree.indices = _.chain(attrs)
    .map(function (attr) {
      var result = {_attr: attr};
      tree.walk(function (node) {
        if (node.model.hasOwnProperty(attr)) {
          result[node.model[attr]] = node;
        }
      });
      return result;
    })
    .indexBy('_attr')
    .value();
}

// connect to the ontologies database
collections.genetrees.mongoCollection().then(function(coll) {
  coll.find().toArray(function (err, docs) {
    collections.closeMongoDatabase();
    if (err) throw err;
    var countOfGenes = 0;
    
    var genetreeIdLut = docs.reduce(function (acc, doc) {
      var tree = new TreeModel().parse(doc);
      indexTree(tree,['gene_stable_id']);
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
            if (leaf.model.representative.score < 0) {
              return {
                id: leaf.model.gene_stable_id,
                rep: null // because rep = id so not needed leaf.model.representative.id
              };
            }
            var node = leaf;
            while (node.hasOwnProperty('parent')) {
              node = node.parent;
              if (node.model.representative.score < -5) {
                return {
                  id: leaf.model.gene_stable_id,
                  rep: node.model.representative.id
                };
              }
            }
            return {
              id: leaf.model.gene_stable_id,
              rep: null
            };
          })
          .forEach(function (gene) {
            if (gene.rep) {
              var repNode = tree.indices.gene_stable_id[gene.rep].model;
              var representative = {
                id: gene.rep,
                taxon_id: repNode.taxon_id
              };
              if (repNode.hasOwnProperty('gene_display_label')) {
                representative.name = repNode.gene_display_label;
              }
              if (repNode.hasOwnProperty('gene_description')) {
                representative.description = repNode.gene_description;
              }
              acc[gene.id] = _.cloneDeep(lookupValue);
              acc[gene.id].representative = representative;
            }
            else {
              acc[gene.id] = lookupValue;
            }
            
            ++countOfGenes;
          });
      });
      return acc;
    }, {});

    modifyGeneDocs(genetreeIdLut);
  });
});

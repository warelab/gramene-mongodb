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
      // indexTree(tree,['gene_stable_id']);
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

        var leafIdx = {}; // so we can get the leaf nodes by ID
        var isAT = new RegExp(/^AT/);
        if (subtree.model.representative.id.match(isAT)) {
          subtree.model.ath_rep = subtree.model.representative;
        }
        // starting at the root of the subtree, assign good representatives to their bad children
        subtree.walk({strategy: 'pre'}, function (node) {
          if (node.model.representative.score >= -80) return false; // there's no hope for this tree
          node.children.forEach(function(child) {
            if (child.model.representative.score >= -80) {
              child.model.representative.score = node.model.representative.score;
              child.model.representative.id = node.model.representative.id;
            }
            // try to add an arabidopsis representative
            if (child.model.representative.id.match(isAT)) {
              child.model.ath_rep = child.model.representative;
            }
            else if (node.model.ath_rep) {
              child.model.ath_rep = node.model.ath_rep;
            }
          });
          if (!node.hasChildren()) {
            leafIdx[node.model.gene_stable_id] = node.model;
          }
        });

        _.forEach(leafIdx, function(leaf, id) {
          // non-arabidopsis genes also get a closest arabidopsis ortholog representative

          if (leaf.representative.score >= -80) {
            // no representative
            acc[id] = lookupValue;
          }
          else {
            if (leaf.representative.id === id) {
              if (leaf.taxon_id !== 3702) {
                acc[id] = lookupValue; // doesn't need a representative
              }
              else {
                // not ath, check for ath_rep
                if (leaf.ath_rep) {
                  var repNode = leafIdx[leaf.ath_rep.id];
                  var representative = {
                    id: repNode.gene_stable_id,
                    taxon_id: repNode.taxon_id
                  };
                  if (repNode.hasOwnProperty('gene_display_label')) {
                    representative.name = repNode.gene_display_label;
                  }
                  if (repNode.hasOwnProperty('gene_description')) {
                    representative.description = repNode.gene_description;
                  }
                  acc[id] = _.cloneDeep(lookupValue);
                  acc[id].representative = {model: representative};
                }
              }
            }
            else {
              // non-self representative 
              acc[id] = _.cloneDeep(lookupValue);
              var repNode = leafIdx[leaf.representative.id];
              var representative = {
                id: repNode.gene_stable_id,
                taxon_id: repNode.taxon_id
              };
              if (repNode.hasOwnProperty('gene_display_label')) {
                representative.name = repNode.gene_display_label;
              }
              if (repNode.hasOwnProperty('gene_description')) {
                representative.description = repNode.gene_description;
              }
              acc[id].representative = {
                closest: representative
              };
              if (leaf.ath_rep && leaf.ath_rep.id !== leaf.representative.id) {
                var athNode = leafIdx[leaf.ath_rep.id];
                var ath = {
                  id: athNode.gene_stable_id,
                  taxon_id: athNode.taxon_id
                };
                if (athNode.hasOwnProperty('gene_display_label')) {
                  ath.name = athNode.gene_display_label;
                }
                if (athNode.hasOwnProperty('gene_description')) {
                  ath.description = athNode.gene_description;
                }
                acc[id].representative.model = ath;
              }
            }
          }
          ++countOfGenes;
        });
      });
      return acc;
    }, {});

    modifyGeneDocs(genetreeIdLut);
  });
});

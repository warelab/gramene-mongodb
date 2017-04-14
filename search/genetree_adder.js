#!/usr/bin/env node
var _ = require('lodash'),
  Q = require('q'),
  TreeModel = require('tree-model'),
  collections = require('gramene-mongodb-config'),
  through2 = require('through2');

function getLut(main_db) {
  var deferred = Q.defer();
  collections.genetrees.mongoCollection().then(function(coll) {
    console.error('genetree_adder find() started');
    coll.find().toArray(function (err, docs) {
      console.error('loaded '+docs.length+' gene trees from mongodb');
      // collections.closeMongoDatabase();
      if (err) throw err;
      var countOfGenes = 0;

      var geneTrees = {main:[],aux:[]};
      docs.forEach(function(doc) {
        if (doc.compara_db === main_db) {
          geneTrees.main.push(doc);
        }
        else {
          geneTrees.aux.push(doc);
        }
      });

      var genetreeIdLut = {main:{},aux:{}};
      for (var treeType in geneTrees) {
        genetreeIdLut[treeType] = geneTrees[treeType].reduce(function (acc, doc) {
          var tree = new TreeModel().parse(doc);

          var lookupValue = {
            id: tree.model.tree_stable_id,
            root_taxon_id: tree.model.taxon_id,
            root_taxon_name: tree.model.taxon_name
          };

          var leafIdx = {}; // so we can get the leaf nodes by ID
          tree.walk(function (node) {
            if (!node.hasChildren()) {
              leafIdx[node.model.gene_stable_id] = node.model;
            }
          });
        
          var isAT = new RegExp(/^AT/);
          if (tree.model.representative.id.match(isAT)) {
            tree.model.ath_rep = tree.model.representative;
          }
          // starting at the root of the tree, assign good representatives to their bad children
          tree.walk({strategy: 'pre'}, function (node) {
            if (node.model.representative.score >= -80) return false; // there's no hope for this subtree
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
          });

          _.forEach(leafIdx, function(leaf, id) {
            // non-arabidopsis genes also get a closest arabidopsis ortholog representative

            if (leaf.representative.score >= -80) {
              // no representative
              acc[id] = lookupValue;
            }
            else {
              if (leaf.representative.id === id) {
                if (leaf.taxon_id === 3702) {
                  acc[id] = lookupValue; // doesn't need a representative
                }
                else {
                  // not ath, check for ath_rep
                  var repNode = leaf.ath_rep ? leafIdx[leaf.ath_rep.id] : leafIdx[id];
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
          return acc;
        }, {});
      }
      console.error('genetreeIdLut ready');
      deferred.resolve(genetreeIdLut);
    });
  });
  return deferred.promise;
}


module.exports = function(db) {
  
  var lutPromise = getLut(db);
  
  return through2.obj(function (gene, enc, done) {
    var that = this;
  
    lutPromise.then(function(genetreeLUT) {
      var tree = genetreeLUT.main[gene._id];
      if(tree) {
        if (! gene.hasOwnProperty('homology')) {
          gene.homology = {};
        }
        gene.homology.gene_tree = tree;
      }
    
      var auxTree = genetreeLUT.aux[gene._id];
      if (auxTree) {
        if (! gene.hasOwnProperty('homology')) {
          gene.homology = {};
        }
        gene.homology.pan_tree = auxTree;
      }

      that.push(gene);
      done();
    });
  });
}
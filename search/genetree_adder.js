#!/usr/bin/env node
var _ = require('lodash'),
  Q = require('q'),
  TreeModel = require('tree-model'),
  collections = require('gramene-mongodb-config'),
  through2 = require('through2');

function cigarToConsensus(cigar, seq) {

  var pieces = cigar.split(/([DM])/);
  var clength=0;
  var stretch=0;
  pieces.forEach(function (piece) {
    if (piece === "M" || piece === "D") {
      if (stretch === 0) stretch = 1;
      clength += stretch;
    }
    else {
      stretch = +piece;
    }
  });
  stretch = 0;
  var size = 0;
  var gap = '-'.charCodeAt(0);
  var alignseq = new Uint16Array(clength);
  alignseq.fill(gap);
  var offset=0;
  pieces.forEach(function (piece) {
    if (piece === "M") {
      if (stretch === 0) stretch = 1;
      for(var i=0;i<stretch;i++) {
        alignseq[offset++] = seq.charCodeAt(size + i);
      }
      size += stretch;
      stretch = 0;
    }
    else if (piece === "D") {
      if (stretch === 0) stretch = 1;
      offset += stretch;
      stretch = 0;
    }
    else if (!!piece) {
      stretch = +piece;
    }
  });
  return {sequence: alignseq};
}

function calc_identity(geneA, geneB) {
  if (geneA === geneB) {
    return 1;
  }

  if (! geneA.consensus) {
    geneA.consensus = cigarToConsensus(geneA.cigar, geneA.sequence);
  }
  if (! geneB.consensus) {
    geneB.consensus = cigarToConsensus(geneB.cigar, geneB.sequence);
  }

  var seqA = geneA.consensus.sequence;
  var seqB = geneB.consensus.sequence;
  if (seqA.length !== seqB.length) {
    mylog('alignment sequences are not the same length');
    return 0;
  }

  var matchCnt = 0;
  var totalCnt = seqA.length;
  var gapCode = '-'.charCodeAt(0);
  for(var i=0; i<seqA.length; i++) {
    if (seqA[i] === seqB[i]) {
      if (seqA[i] === gapCode) totalCnt--;
      else matchCnt++;
    }
  }
  return matchCnt/totalCnt;
}

function walk(node, cb) {
  cb(node);
  if (node.children) {
    node.children.forEach(c => {
      walk(c,cb);
    })
  }
}
function mylog(str) {
  var ts = new Date();
  console.error(ts.toLocaleString(), str)
}
function getLut(main_db) {
  var deferred = Q.defer();
  collections.genetrees.mongoCollection().then(function(coll) {
    mylog('genetree_adder find() started');
    coll.find().toArray(function (err, docs) {
      mylog('loaded '+docs.length+' gene trees from mongodb');
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
      mylog(`genetree_adder ${geneTrees.main.length} main trees`);
      mylog(`genetree_adder ${geneTrees.aux.length} aux trees`);
      var genetreeIdLut = {main:{},aux:{}};
      for (var treeType in geneTrees) {
        genetreeIdLut[treeType] = geneTrees[treeType].reduce(function (acc, tree) {
          // var tree = new TreeModel().parse(doc);

          var lookupValue = {
            id: tree.tree_stable_id,
            root_taxon_id: tree.taxon_id,
            root_taxon_name: tree.taxon_name
          };

          var leafIdx = {}; // so we can get the leaf nodes by ID
          walk(tree, function (node) {
            if (!node.children) {
              leafIdx[node.gene_stable_id] = node;
            }
          });
        
          var isAT = new RegExp(/^AT/);
          if (!tree.representative) {
            console.mylog('no rep in tree',JSON.stringify(tree,null,2));
          }
          if (tree.representative.id.match(isAT)) {
            tree.ath_rep = tree.representative;
          }
          // starting at the root of the tree, assign good representatives to their bad children
          walk(tree, function (node) {
            if (node.representative.score >= -60) return false; // there's no hope for this subtree
            if (node.children) {
              node.children.forEach(function(child) {
                if (child.representative.score > .8*node.representative.score) {
                  child.representative.score = node.representative.score;
                  child.representative.id = node.representative.id;
                }
                // try to add an arabidopsis representative
                if (child.representative.id.match(isAT)) {
                  child.ath_rep = child.representative;
                }
                else if (node.ath_rep) {
                  child.ath_rep = node.ath_rep;
                }
              });
            }
          });
          // find duplication nodes with > 50% confidence
          var duplications = [];
          walk(tree,function(node) {
            if (node.duplication_confidence_score > 0.5) duplications.push(node);
          });

          // associate duplication nodes with leaf genes
          duplications.forEach(function(subtree) {
            walk(subtree,function(node) {
              if (!node.children) {
                if (!node.hasOwnProperty('duplications')) {
                  node.duplications = {};
                }
                node.duplications[subtree.taxon_id] = 1;
              }
            });
          });
          

          _.forEach(leafIdx, function(leaf, id) {
            // convert duplications into an array
            if (leaf.duplications) {
              lookupValue.duplications = Object.keys(leaf.duplications).map(function(tid) {return +tid});
            }
            // non-arabidopsis genes also get a closest arabidopsis ortholog representative
            if (!leaf.representative) {
              console.mylog('leaf lacks representative', leaf);
            }
            if (leaf.representative.score >= -60 || leaf.taxon_id === 3702001) {
              // no representative
              acc[id] = lookupValue;
            }
            else {
              if (leaf.representative.id === id) {
                // not ath, check for ath_rep
                var repNode = leaf.ath_rep ? leafIdx[leaf.ath_rep.id] : leafIdx[id];
                var representative = {
                  id: repNode.gene_stable_id,
                  taxon_id: repNode.taxon_id,
                  percent_identity: calc_identity(repNode, leaf)
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
              else {
                // non-self representative 
                acc[id] = _.cloneDeep(lookupValue);
                var repNode = leafIdx[leaf.representative.id];
                var representative = {
                  id: repNode.gene_stable_id,
                  taxon_id: repNode.taxon_id,
                  percent_identity: calc_identity(repNode, leaf)
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
                    taxon_id: athNode.taxon_id,
                    percent_identity: calc_identity(athNode, leaf)
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
      mylog('genetreeIdLut ready');
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
      if (genetreeLUT.main.hasOwnProperty(gene._id)) {
        if (! gene.hasOwnProperty('homology')) {
          gene.homology = {};
        }
        gene.homology.gene_tree = genetreeLUT.main[gene._id];
      }
      if (genetreeLUT.aux.hasOwnProperty(gene._id)) {
        if (! gene.hasOwnProperty('homology')) {
          gene.homology = {};
        }
        gene.homology.pan_tree = genetreeLUT.aux[gene._id];
      }
      that.push(gene);
      done();
    });
  });
}
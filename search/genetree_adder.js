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

      // Group by tree_set -- the tag trees/genetree.js writes onto each tree. This was a
      // main/aux split on compara_db, which could only ever express two sets; there are now six:
      // the default plants trees plus the four crop cultivar clustersets and the pan-homology
      // trees. Each set becomes genes.homology.<set>, so a consumer reads the homology object's
      // keys to learn which trees a gene is in.
      //
      // The fallback keeps a part-rebuilt collection working: a doc written before tree_set
      // existed is attributed by compara_db exactly as before, and its 'pan_tree' key matches the
      // pre-existing Solr field of that name. Pan-homology trees are not loaded, so in practice
      // every doc carries a tree_set and the fallback never fires.
      var geneTrees = {};
      docs.forEach(function(doc) {
        var set = doc.tree_set || (doc.compara_db === main_db ? 'gene_tree' : 'pan_tree');
        (geneTrees[set] = geneTrees[set] || []).push(doc);
      });
      Object.keys(geneTrees).sort().forEach(function (set) {
        mylog(`genetree_adder ${geneTrees[set].length} trees in set '${set}'`);
      });
      var genetreeIdLut = {};
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
          // A node can legitimately arrive here with no `representative`: trees/genetree.js used
          // to assign them from a gene_stable_id-keyed index, and two leaves in one tree can
          // share an id (medicago_truncatula and lablab_purpureus both name their genes
          // geneNNNN and share 24,925 ids), so the second leaf got none. That is fixed in the
          // builder, but a single such node used to abort the entire 16.1M-gene decorate with
          // "Cannot read properties of undefined (reading 'score')" after the trees had loaded.
          // Skipping the node and reporting the count is the right failure mode here: the
          // representative only drives display, so one unlabelled subtree is worth vastly less
          // than the whole stage. Note that walk()'s `return false` does NOT prune -- children
          // are visited regardless -- so the node and each child are checked separately.
          var repless = 0;
          if (!tree.representative) {
            mylog('no representative on root of tree ' + tree.tree_stable_id + ' - skipping propagation');
          }
          else {
            if (tree.representative.id.match(isAT)) {
              tree.ath_rep = tree.representative;
            }
            // starting at the root of the tree, assign good representatives to their bad children
            walk(tree, function (node) {
              if (!node.representative) { repless++; return false; }
              if (node.representative.score >= -60) return false; // there's no hope for this subtree
              if (node.children) {
                node.children.forEach(function(child) {
                  if (!child.representative) { repless++; return; }
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
          }
          if (repless) {
            mylog('tree ' + tree.tree_stable_id + ': ' + repless + ' node(s) with no representative - skipped');
          }
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
            // Same shape of bug as the walk above: this guard called console.mylog, which does
            // not exist (the logger is `mylog`), so it threw a TypeError instead of logging and
            // then fell through to deref `.representative` regardless. Treat a repless leaf the
            // way the next branch treats an unusable representative -- record the tree
            // association and move on.
            if (!leaf.representative) {
              mylog('leaf ' + id + ' in tree ' + tree.tree_stable_id + ' lacks a representative');
              acc[id] = lookupValue;
              return;
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
      // One key per tree set the gene appears in. A gene can legitimately be in several -- a
      // wheat cultivar gene sits in both the default plants tree and the wheat_cultivars tree --
      // so these are additive rather than exclusive, and the absence of a key simply means the
      // gene is not in that set.
      var sets = Object.keys(genetreeLUT);
      for (var si = 0; si < sets.length; si++) {
        var set = sets[si];
        if (genetreeLUT[set].hasOwnProperty(gene._id)) {
          if (! gene.hasOwnProperty('homology')) {
            gene.homology = {};
          }
          gene.homology[set] = genetreeLUT[set][gene._id];
        }
      }
      that.push(gene);
      done();
    });
  });
}
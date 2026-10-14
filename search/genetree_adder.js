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
    // STREAMED, NOT toArray(). The collection is 224,197 trees / 12.4 GB of uncompressed BSON
    // (the four cultivar sets are 7.0 GB of that: their trees average 123-202 KB against the
    // default set's 34 KB, because a cultivar clusterset packs many closely-related genomes).
    // toArray() materialises all of it as live JS objects at once, several times the BSON size in
    // heap, and on 2026-10-13 that aborted at 16.4 GB with
    //   FATAL ERROR: NewSpace::EnsureCurrentCapacity Allocation failed
    // which is the OS refusing memory, NOT V8's configured limit -- the limit really was 48 GB
    // (verified: heap_size_limit 49344 MB), and mongod alone held 101.5 GB RSS with 38 of 63 GB
    // of swap already gone. Raising the heap therefore would not have helped.
    //
    // Nothing here needed the whole array: the per-tree body below only ever reads one tree, and
    // the only cross-tree state is the countOfGenes tally and the LUT itself. So we stream the
    // cursor and keep just the LUT -- one entry per gene per set, which is far smaller than the
    // trees it is derived from. Keep it streamed; the collection only grows.
    var countOfGenes = 0;
    var genetreeIdLut = {};
    var setCounts = {};
    var treesSeen = 0;

    // Bucket by tree_set -- the tag trees/genetree.js writes onto each tree. This was a main/aux
    // split on compara_db, which could only ever express two sets; there are now five: the default
    // plants trees plus the four crop cultivar clustersets. Each becomes genes.homology.<set>, so a
    // consumer reads the homology object's keys to learn which trees a gene is in.
    //
    // The fallback keeps a part-rebuilt collection working: a doc written before tree_set existed
    // is attributed by compara_db exactly as before, and its 'pan_tree' key matches the
    // pre-existing Solr field of that name. Pan trees are not loaded, so in practice every doc
    // carries a tree_set and the fallback never fires.
    var addTreeToLut = function (acc, tree) {
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
    };

    mylog('genetree_adder streaming trees from mongodb');
    // PAGED BY _id, not one long-lived cursor. A single cursor over this collection failed twice
    // on 2026-10-13/14, in two different ways, because the per-tree work below is slow enough
    // (calc_identity walks the full alignment for every one of ~11M leaves) that the cursor stays
    // open for the better part of an hour:
    //   1. mongod's 10-minute cursorTimeoutMillis killed it mid-iteration;
    //   2. with noCursorTimeout set, iteration instead stopped dead at 220,000 of 224,197 trees --
    //      cursor gone server-side, zero CPU, no pending I/O, the forEach promise never settling
    //      and neither callback ever firing, so the stage sat idle indefinitely.
    // Paging sidesteps the whole class of problem: no query lives more than a few seconds, nothing
    // depends on server-side cursor state surviving our CPU time, and a failed page rejects
    // normally. _id is the tree stable id and is always indexed, so the sort is free.
    var PAGE = 2000;

    var processPage = function (lastId) {
      var q = lastId === null ? {} : {_id: {$gt: lastId}};
      return coll.find(q).sort({_id: 1}).limit(PAGE).toArray().then(function (docs) {
        if (!docs.length) { return null; }
        for (var k = 0; k < docs.length; k++) {
          var doc = docs[k];
          var set = doc.tree_set || (doc.compara_db === main_db ? 'gene_tree' : 'pan_tree');
          setCounts[set] = (setCounts[set] || 0) + 1;
          if (!genetreeIdLut[set]) { genetreeIdLut[set] = {}; }
          addTreeToLut(genetreeIdLut[set], doc);
          // Progress with heap, so a memory problem is visible as it builds rather than only as an
          // abort, and so a stall is visible at all -- the two hangs above were silent.
          if (++treesSeen % 20000 === 0) {
            mylog('  ' + treesSeen + ' trees -> ' + countOfGenes + ' gene entries, heap ' +
                  Math.round(process.memoryUsage().heapUsed / 1048576) + ' MB');
          }
        }
        return docs[docs.length - 1]._id;
      });
    };

    var nextPage = function (lastId) {
      return processPage(lastId).then(function (next) {
        return next === null ? undefined : nextPage(next);
      });
    };

    mylog('genetree_adder paging trees from mongodb (' + PAGE + ' per query)');
    nextPage(null).then(function () {
      Object.keys(setCounts).sort().forEach(function (set) {
        mylog('genetree_adder ' + setCounts[set] + " trees in set '" + set + "'");
      });
      mylog('genetreeIdLut ready: ' + treesSeen + ' trees, ' + countOfGenes +
            ' gene entries, heap ' +
            Math.round(process.memoryUsage().heapUsed / 1048576) + ' MB');
      deferred.resolve(genetreeIdLut);
    }, function (err) {
      // Do not just reject: the only consumer does lutPromise.then(fn) with no error handler, so a
      // rejection here previously vanished and the stage hung instead of failing.
      mylog('FATAL: genetree LUT build failed after ' + treesSeen + ' trees: ' +
            (err && err.stack || err));
      deferred.reject(err);
      process.exit(1);
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
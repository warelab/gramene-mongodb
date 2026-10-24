#!/usr/bin/env node
// supertrees.js — attach each gene's SUPERTREE id, per tree set, as homology.<set>.supertree
//
// A compara supertree sits above a family too large to align in one go: the family is split into
// subtrees and the supertree joins them. Its own nodes carry NO genes (verified: 38,465 supertree
// nodes across all 5,275 supertrees, zero seq_member leaves), so nothing here affects tree
// MEMBERSHIP -- it only records which larger family a gene's tree belongs to.
//
// WHY THIS IS A REWRITE, NOT A COPY of release69/gramene-mongodb/search/supertrees.js:
//
//  1. r69 hardcoded clusterset_id="default", which misses two thirds of the data. Supertrees are
//     NOT default-only: default 1,549 / oat 963 / wheat 888 / barley 923 / rice 806 of them carry
//     subtree links (11,035 / 5,095 / 5,061 / 5,051 / 4,739 links respectively).
//  2. r69 looked up only homology.gene_tree.id, so a gene whose CULTIVAR subtree had a supertree
//     could never match even with the clusterset filter removed.
//  3. r69 wrote a single scalar homology.supertree. A gene can be in a default supertree AND a
//     cultivar one; one scalar cannot hold both, and _.mergeWith with an array-only customizer
//     overwrites a scalar silently. Hence per-set placement here, mirroring the tree ids.
//  4. 651 cultivar subtrees under supertrees have NO stable_id (oat 257, barley 236, wheat 145,
//     rice 13). Keying on stable_id alone yields NULL for those, so they would drop silently --
//     the same failure that hid 162,111 unnamed trees. The ids come from trees/tree_sets.js so
//     they match what genetree.js wrote, synthetic ones included.
//  5. r69 exported an async function, i.e. a PROMISE of a stream -- which is why its own
//     `stream.pipe(supertreeAdder)` call was commented out: you cannot pipe a promise. This
//     returns the stream synchronously and resolves the lookup inside the transform, which is the
//     pattern fix_maize_v5.js and the other adders in this directory already use.
var mysql = require('mysql2/promise');
var compara = require('../ensembl_db_info.json').compara;
var _ = require('lodash');
var through2 = require('through2');
var TREE_SETS = require('../trees/tree_sets').TREE_SETS;
var idSql = require('../trees/tree_sets').idSql;

// subtree -> supertree, per set. The join: a supertree root's child node is the parent of a
// subtree's ROOT node (tn.node_id = tn.root_id), and that subtree root identifies the tree.
function buildMaps() {
  var esc = function (v) { return mysql.escape ? mysql.escape(v) : "'" + String(v).replace(/'/g, "\\'") + "'"; };
  return mysql.createConnection(compara).then(function (db) {
    var maps = {};
    return TREE_SETS.reduce(function (chain, ts) {
      return chain.then(function () {
        var sql = 'select ' + idSql('t', ts, esc, true) + ' as tree,\n'
                + idSql('s', ts, esc, false) + ' as supertree\n'
                + 'from gene_tree_root s, gene_tree_node sn, gene_tree_node tn, gene_tree_root t\n'
                + 'where s.clusterset_id = ' + esc(ts.clusterset) + "\n"
                + "  and s.tree_type = 'supertree'\n"
                // Constrain the SUBTREE too. Without this the join also returns supertrees nested
                // under supertrees -- 106 such links in default, 95 oat, 88 barley, 63 wheat,
                // 3 rice. They map a supertree id to its parent supertree, which no gene can ever
                // carry (supertree nodes hold no genes), so they were harmless but inflated the
                // map and made the logged counts misleading. r69's query had the same gap.
                + "  and t.tree_type = 'tree'\n"
                + '  and t.clusterset_id = s.clusterset_id\n'
                + '  and s.root_id = sn.parent_id\n'
                + '  and sn.node_id = tn.parent_id\n'
                + '  and tn.node_id = tn.root_id\n'
                + '  and tn.root_id = t.root_id';
        return db.query(sql).then(function (res) {
          var rows = res[0], m = new Map();
          rows.forEach(function (r) { if (r.tree && r.supertree) { m.set(r.tree, r.supertree); } });
          maps[ts.set] = m;
          // Count the SUPERTREES, not the mappings. r69 logged
          // `new Set(superMap.values()).size` over freshly built object literals, so every value
          // was a distinct identity and the figure always equalled the row count.
          var distinct = new Set();
          m.forEach(function (v) { distinct.add(v); });
          console.error('supertrees[' + ts.set + ']: ' + m.size + ' subtrees -> '
                        + distinct.size + ' supertrees');
        });
      });
    }, Promise.resolve()).then(function () {
      return db.end().then(function () { return maps; });
    }, function (err) {
      // Fail loudly. r69 caught, logged and returned undefined, so the caller's first use of the
      // map threw an unrelated TypeError instead of reporting the real problem.
      return db.end().then(function () { throw err; }, function () { throw err; });
    });
  });
}

module.exports = function () {
  var mapsPromise = buildMaps();
  // Surface a connection/query failure as a stream error rather than an unhandled rejection.
  var failed = null;
  mapsPromise.catch(function (e) { failed = e; });

  return through2.obj(function (gene, enc, done) {
    var that = this;
    if (!_.isObject(gene)) { return done(new Error('supertrees: gene is not an object')); }
    mapsPromise.then(function (maps) {
      TREE_SETS.forEach(function (ts) {
        var h = gene.homology && gene.homology[ts.set];
        if (h && h.id) {
          var st = maps[ts.set].get(h.id);
          if (st) { h.supertree = st; }
        }
      });
      that.push(gene);
      done();
    }, function (err) { done(failed || err); });
  });
};

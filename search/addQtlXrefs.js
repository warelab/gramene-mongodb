#!/usr/bin/env node
// Annotate genes with QTL_TO xrefs for any QTL that fully contains the gene.
// Uses an interval tree per (map, region) for O(log n + k) containment queries.
//
// IMPORTANT: the per-gene work is SYNCHRONOUS. The QTL interval trees are loaded
// once up front; only the first gene(s) wait on that load, after which every gene
// is processed synchronously (push + callback in the same tick). An earlier
// version did `treesPromise.then(...)` per gene — that async hop per gene broke
// downstream backpressure with the config's mongodb@2 driver, so decorate's
// connection closed mid-stream and only the tail of the genes persisted. Keeping
// it synchronous (like the rest of the decorate adders) avoids that.
//
// Dependency: "@flatten-js/interval-tree" (v1 or v2; .default export, insert/search).

var Q = require('q');
var through2 = require('through2');
var IntervalTree = require('@flatten-js/interval-tree').default;
var collections = require('gramene-mongodb-config');

// Build { map: { region: IntervalTree } }. Each tree stores the QTL record as the
// value; the interval key is [qtl.start, qtl.end].
function getQTLTrees() {
  var deferred = Q.defer();
  var trees = {};
  collections.qtls.mongoCollection().then(function(coll) {
    coll.find().toArray(function(err, result) {
      if (err) { deferred.reject(err); return; }
      result.forEach(function(qtl) {
        var map = qtl.location.map;
        var region = qtl.location.region;
        trees[map] ||= {};
        trees[map][region] ||= new IntervalTree();
        trees[map][region].insert(
          [qtl.location.start, qtl.location.end],
          { id: qtl._id, start: qtl.location.start, end: qtl.location.end, terms: qtl.terms }
        );
      });
      deferred.resolve(trees);
    });
  }, function(err) { deferred.reject(err); });
  return deferred.promise;
}

module.exports = function() {

  var trees = null;
  var loading = getQTLTrees().then(function(t) { trees = t; });

  // synchronous containment annotation for a single gene
  function annotate(gene) {
    var map = gene.location && gene.location.map;
    var region = gene.location && gene.location.region;
    var tree = trees[map] && trees[map][region];
    if (tree) {
      // search returns values for intervals overlapping [gene.start, gene.end];
      // keep only those that FULLY contain the gene.
      var hits = tree.search([gene.location.start, gene.location.end]);
      var terms = {};
      var found = 0;
      hits.forEach(function(qtl) {
        if (qtl.start <= gene.location.start && qtl.end >= gene.location.end) {
          qtl.terms.forEach(function(t) { terms[t] = 1; });
          found++;
        }
      });
      if (found > 0) {
        gene.xrefs.push({ db: 'QTL_TO', ids: Object.keys(terms) });
      }
    }
  }

  return through2.obj(function (gene, enc, callback) {
    var that = this;
    if (trees) {                          // common case: trees loaded -> synchronous
      annotate(gene); that.push(gene); callback();
    } else {                              // only the first gene(s) wait for the load
      loading.then(function() { annotate(gene); that.push(gene); callback(); },
                   function(err) { callback(err); });
    }
  });
};

#!/usr/bin/env node
// homolog_adder — decorate stage: attach cross-species homologs to each gene.
// Reads the per-gene homolog store built by build_homologs.js + load_homolog_mongo.js:
// mongo collection `homologs`, {_id: gene stable_id, homologous_genes: {kind: [stable_id]}}.
// Output is unchanged: gene.homology.homologous_genes[kind] = [otherStableId, ...].
//
// History: redis db 9 -> LMDB -> mongo. LMDB was dropped because it is memory-mapped: reading it
// once per gene while streaming ~5.4M genes faulted an ever-growing share of the 18GB map into
// decorate's own RSS (~1GB per 175k genes, ~9-10GB by the point decorate wedged), on top of its
// ~7-12GB of lookup tables. Mongo keeps that cache inside mongod, bounded by WiredTiger, so
// decorate's footprint stays flat.
//
// Lookups are batched: genes are buffered up to BATCH and resolved with a single $in query, so
// this is ~27k queries for a 5.4M-gene run instead of ~5.4M, while the buffer stays bounded.
var through2 = require('through2');
var collections = require('gramene-mongodb-config');

var BATCH = 200;

module.exports = function () {
  var collPromise = collections.homologs.mongoCollection();
  console.error('homolog_adder reading mongo collection "homologs"');

  var buf = [];

  function resolve(that, cb) {
    if (!buf.length) return cb();
    var genes = buf;
    buf = [];
    var ids = genes.map(function (g) { return g._id; });
    collPromise.then(function (coll) {
      coll.find({ _id: { $in: ids } }).toArray(function (err, docs) {
        if (err) {
          // Surface rather than hang: a swallowed error here would leave done() uncalled and
          // deadlock the whole decorate pipeline with no output.
          console.error('homolog_adder FAILED on a batch of ' + ids.length +
                        ' genes (first=' + ids[0] + '): ' + (err.stack || err));
          return cb(err);
        }
        var byId = Object.create(null);
        for (var i = 0; i < docs.length; i++) byId[docs[i]._id] = docs[i];
        for (var j = 0; j < genes.length; j++) {
          var gene = genes[j];
          var doc = byId[gene._id];
          if (doc && doc.homologous_genes) {   // gene.homology untouched when it has no homologs
            if (gene.homology) gene.homology.homologous_genes = doc.homologous_genes;
            else gene.homology = { homologous_genes: doc.homologous_genes };
          }
          that.push(gene);                     // order preserved: buf is FIFO
        }
        cb();
      });
    }).catch(function (err) {
      console.error('homolog_adder FAILED to open the homologs collection: ' +
                    (err && err.stack || err));
      cb(err instanceof Error ? err : new Error(String(err)));
    });
  }

  return through2.obj(function (gene, enc, done) {
    buf.push(gene);
    if (buf.length >= BATCH) resolve(this, done);   // done() fires after the query settles
    else done();                                    // at most BATCH-1 genes held
  }, function (done) {
    resolve(this, done);                            // final partial batch
  });
};

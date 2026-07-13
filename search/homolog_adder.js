#!/usr/bin/env node
// homolog_adder — decorate stage: attach cross-species homologs to each gene.
// Reads the per-gene homolog store built by build_homologs.js: an on-disk LMDB (dupSort) keyed by gene
// stable_id, whose values are "<otherStableId>\t<kind>" (one per homolog, both directions written).
// (Previously this read redis db 9; moved to LMDB because the full-plants homolog set is too large for
// redis RAM.) Output is unchanged: gene.homology.homologous_genes[kind] = [otherStableId, ...].
var through2 = require('through2');
var { open } = require('lmdb');

module.exports = function (lmdbPath) {
  var db = open({ path: lmdbPath, readOnly: true, dupSort: true, encoding: 'string' });
  console.error('homolog_adder reading LMDB ' + lmdbPath);

  return through2.obj(function (gene, enc, done) {
    var homologous_genes = null;             // stays null (and gene.homology untouched) if no homologs
    for (var v of db.getValues(gene._id)) {  // empty iterable when the gene has no homologs
      if (!homologous_genes) {
        if (gene.homology) gene.homology.homologous_genes = {};
        else gene.homology = { homologous_genes: {} };
        homologous_genes = gene.homology.homologous_genes;
      }
      var tab = v.indexOf('\t');
      var otherId = v.slice(0, tab);
      var kind = v.slice(tab + 1);
      if (!homologous_genes.hasOwnProperty(kind)) homologous_genes[kind] = [];
      homologous_genes[kind].push(otherId);
    }
    this.push(gene);
    done();
  });
};

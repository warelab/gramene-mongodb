#!/usr/bin/env node
// vitis_synonym_adder — add the alternate grapevine ID schemes (VCost.v3 "Vitvi…"
// and the expression pipeline's "Vitis…") as `synonyms` on each canonical 12X
// "VIT_…" gene, so the genes collection itself is the crosswalk: Plant Reactome,
// EBI Atlas, and expression_attributes can all resolve to the VIT_ gene._id, and
// solr search-by-Vitvi/Vitis finds the gene (mongo2solr carries synonyms through).
//
// Reads gramene-mongodb/search/vitis_crosswalk.tsv  (VIT_ <tab> Vitvi <tab> Vitis),
// keyed by the canonical VIT_ id. Tolerates a missing file (passthrough), like
// msu6_adder, so it never breaks the 5.2M-gene decorate hot path.
var Q = require('q');
var through2 = require('through2');
var _ = require('lodash');

function getMapping() {
  var deferred = Q.defer();
  var lut = {};
  var filename = 'vitis_crosswalk.tsv';
  var stream;
  try {
    stream = require('fs').createReadStream(filename);
  } catch (e) {
    console.error('vitis_synonym_adder: ' + filename + ' missing — skipping');
    deferred.resolve({});
    return deferred.promise;
  }
  stream.on('error', function (e) {
    console.error('vitis_synonym_adder: cannot read ' + filename + ' (' + e.message + ') — skipping');
    deferred.resolve({});
  });
  require('readline').createInterface({ input: stream, terminal: false })
    .on('line', function (line) {
      var f = line.split('\t');     // 0=VIT_  1=Vitvi  2=Vitis
      if (!f[0]) return;
      var alts = [];
      if (f[1]) alts.push(f[1]);
      if (f[2]) alts.push(f[2]);
      lut[f[0]] = { alts: alts, vcost: f[1] };
    })
    .on('close', function () {
      console.error('vitis_synonym_adder: loaded crosswalk for ' + Object.keys(lut).length + ' genes');
      deferred.resolve(lut);
    });
  return deferred.promise;
}

module.exports = function () {
  var lut = null;
  var lutPromise = getMapping().then(function (l) { lut = l; return l; });

  return through2.obj(function (gene, enc, done) {
    var self = this;
    function process() {
      var hit = _.isObject(gene) ? lut[gene._id] : null;
      if (hit) {
        if (!gene.hasOwnProperty('synonyms')) gene.synonyms = [];
        hit.alts.forEach(function (s) { gene.synonyms.push(s); });
        gene.synonyms = _.uniq(gene.synonyms);
        if (hit.vcost) {
          if (!gene.hasOwnProperty('xrefs')) gene.xrefs = [];
          gene.xrefs.push({ db: 'VCost', ids: [hit.vcost] });
        }
      }
      self.push(gene);
      done();
    }
    // Synchronous fast path once the (small) LUT is loaded — avoids a per-gene
    // microtask hop, which can break mongodb@2 backpressure mid-stream (the
    // addQtlXrefs lesson). Only the first few genes wait on the promise.
    if (lut) process(); else lutPromise.then(process);
  });
};

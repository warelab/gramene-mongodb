#!/usr/bin/env node
// vitis_synonym_adder — cross-link the grapevine ID schemes (12X "VIT_…", VCost.v3
// "Vitvi…" and the expression pipeline's "Vitis…") as `alt_id`s, in BOTH directions,
// so the genes collection itself is the crosswalk: Plant Reactome,
// EBI Atlas, and expression_attributes can all resolve to the VIT_ gene._id, and
// solr search-by-Vitvi/Vitis finds the gene (mongo2solr carries alt_id through).
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
  var fs = require('fs');
  // existsSync guard: on Node 24 a missing/unreadable file makes the readline Interface
  // re-emit the stream error unhandled and the process exits 1, which would abort the
  // whole decorate pipeline. Check first so a missing file degrades to a passthrough.
  if (!fs.existsSync(filename)) {
    console.error('vitis_synonym_adder: ' + filename + ' missing — skipping');
    deferred.resolve({});
    return deferred.promise;
  }
  var stream = fs.createReadStream(filename);
  var rl = require('readline').createInterface({ input: stream, terminal: false });
  stream.on('error', function (e) {
    console.error('vitis_synonym_adder: cannot read ' + filename + ' (' + e.message + ') — skipping');
    rl.close();
    deferred.resolve({});   // Q ignores a second resolve if 'close' also fires
  });
  // Accumulate rather than assign: an id can appear in several rows (the VCost mapping is
  // 1:many in both directions), and the reverse keys below collide by design.
  function add(id, alts, vcost) {
    if (!id || id === '-') return;
    var e = lut[id] || (lut[id] = { alts: [], vcost: '' });
    alts.forEach(function (a) { if (a && a !== '-' && a !== id) e.alts.push(a); });
    e.alts = _.uniq(e.alts);
    if (vcost) e.vcost = vcost;
  }
  rl.on('line', function (line) {
      var f = line.split('\t');     // 0=VIT_  1=Vitvi  2=Vitis
      if (!f[0]) return;
      // '-' is the crosswalk placeholder for "no id in this scheme" — never an alt id
      var vitvi = (f[1] && f[1] !== '-') ? f[1] : '';
      var vitis = (f[2] && f[2] !== '-') ? f[2] : '';
      // Forward: the canonical VIT_ gene gains the alternate schemes, and only it gets the
      // VCost xref — a Vitvi gene's own _id already IS its VCost identifier.
      add(f[0], [vitvi, vitis], vitvi);
      // Reverse. Where the VCost assembly is loaded as a genome of its OWN -- the grapevine
      // subsite carries both PN40024 annotations, v3 (VIT_, taxon 29760019) and v4 (Vitvi,
      // 29760020) -- those Vitvi ids are real genes that need the crosswalk in their
      // direction too. Without this, `alt_id` lands on 22,074 vitis_vinifera genes and ZERO
      // vitis_viniferapn40024 genes, so a search for a legacy VIT_ id returns only the
      // deprecated v3 gene and never the current reference one (pn40024 is species_idx 1
      // here). This is the same asymmetry reactome/update_vv.pl had, for the same reason:
      // the code assumes VIT_ is the only grapevine genome present.
      // On a site that carries only the VIT_ assembly these keys match no gene, so it is a
      // strict no-op there.
      if (vitvi) add(vitvi, [f[0], vitis], '');
      if (vitis) add(vitis, [f[0], vitvi], '');
    })
    .on('close', function () {
      console.error('vitis_synonym_adder: loaded crosswalk for ' + Object.keys(lut).length +
                    ' ids (both directions)');
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
        // Vitvi.../Vitis... are alternate ids, not synonyms
        if (!gene.hasOwnProperty('alt_id')) gene.alt_id = [];
        hit.alts.forEach(function (s) { gene.alt_id.push(s); });
        gene.alt_id = _.uniq(gene.alt_id);
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

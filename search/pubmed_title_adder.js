#!/usr/bin/env node
// pubmed_title_adder — give a literature reference that arrived without one the paper's title.
//
// Publications.js renders xrefs[].text as the gene page's "Title/Description" column. rap-db supplies
// the title, geneRIF the RIF statement and CSHL the curator's description, but the PUBMED xrefs that
// come straight off the Ensembl cores carry no text at all -- medicago's 4k references are all of
// this kind -- so that column renders empty. This fills it from a cached PMID -> title table.
//
// Reads pubmed_titles.tsv (pmid <tab> title <tab> journal <tab> retrieved), built by
// build/pubmed_titles.js against PubMed's esummary. A title of "-" is a negative cache entry and is
// treated as "no title", not as the text "-". Tolerates a missing file (passthrough), like
// vitis_synonym_adder and msu6_adder, so it can never break the decorate hot path.
//
// Existing text is NEVER overwritten. A curator's own description outranks a journal title, and the
// `source` column exists precisely so a reader can tell the two apart. This also makes the adder
// idempotent and order-independent: it only ever fills a blank.
//
// It modifies the xref in place and pushes nothing, so it is not exposed to the
// ancestor_adder.js:30 `_.keyBy(xrefs,'db')` trap that makes a second xref for the same db hide the
// first -- and PUBMED is not in that adder's XREFS_TO_PROCESS in any case.
var Q = require('q');
var through2 = require('through2');

// The same sentinels decorate's other adders screen: ThaleMine's 'NULL' and '""', and mysql's '\N'.
function usable(v) {
  return !!v && v !== 'NULL' && v !== '""' && v !== '\\N' && String(v).trim() !== '';
}

function getMapping() {
  var deferred = Q.defer();
  var lut = {};
  var filename = 'pubmed_titles.tsv';
  var fs = require('fs');
  // existsSync guard: on Node 24 a missing/unreadable file makes the readline Interface re-emit the
  // stream error unhandled and the process exits 1, which would abort the whole decorate pipeline.
  if (!fs.existsSync(filename)) {
    console.error('pubmed_title_adder: ' + filename + ' missing — skipping');
    deferred.resolve({});
    return deferred.promise;
  }
  var stream = fs.createReadStream(filename);
  var rl = require('readline').createInterface({ input: stream, terminal: false });
  stream.on('error', function (e) {
    console.error('pubmed_title_adder: cannot read ' + filename + ' (' + e.message + ') — skipping');
    rl.close();
    deferred.resolve({});   // Q ignores a second resolve if 'close' also fires
  });
  rl.on('line', function (line) {
      if (!line || line[0] === '#') return;
      var f = line.split('\t');     // 0=pmid  1=title  2=journal  3=retrieved
      if (!f[0]) return;
      // '-' is the negative-cache marker for "PubMed was asked and had nothing usable"
      if (!f[1] || f[1] === '-') return;
      lut[f[0].trim()] = f[1].trim();
    })
    .on('close', function () {
      console.error('pubmed_title_adder: loaded ' + Object.keys(lut).length + ' titles');
      deferred.resolve(lut);
    });
  return deferred.promise;
}

module.exports = function () {
  var lut = null;
  var lutPromise = getMapping().then(function (l) { lut = l; return l; });
  var filled = 0, genes = 0;

  return through2.obj(function (gene, enc, done) {
    var self = this;
    function process() {
      if (gene && gene.xrefs && gene.xrefs.length) {
        var n = 0;
        gene.xrefs.forEach(function (x) {
          if (!x || x.db !== 'PUBMED' || usable(x.text)) return;
          // One record, one paper. Every PUBMED xref in this collection carries a single id, which
          // is what lets one `text` be one paper's title; a record with several ids has no single
          // title to carry, so it is left blank rather than given the wrong one.
          if (!x.ids || x.ids.length !== 1) return;
          var title = lut[String(x.ids[0])];
          if (!title) return;
          x.text = title;
          n++;
        });
        if (n) { filled += n; genes++; }
      }
      self.push(gene);
      done();
    }
    // Synchronous fast path once the LUT is loaded — avoids a per-gene microtask hop, which can
    // break mongodb@2 backpressure mid-stream (the addQtlXrefs lesson). Only the first few genes
    // wait on the promise.
    if (lut) process(); else lutPromise.then(process);
  }, function (done) {
    console.error('pubmed_title_adder: filled ' + filled + ' reference titles on ' + genes + ' genes');
    done();
  });
};

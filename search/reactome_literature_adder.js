#!/usr/bin/env node
// reactome_literature_adder — attach Plant Reactome's curated publications to a gene as
// `{db:'PUBMED', source:'PlantReactome', text:<paper title>, ids:[<pmid>]}`, which Publications.js
// renders in the "Curated publications" tab with "PlantReactome" in the Curation source column.
//
// oryza9 carried these on 6,695 genes across 9 genomes with no generator anywhere in the five
// repos -- they were applied by hand, and the first oryza10 rebuild came out with zero. The rule
// and its evidence are documented in build/fetch_reactome_literature.js, which writes the
// artifact this adder reads. In short:
//
//   gene -> R-OSA event (Ensembl2PlantReactomeReactions.txt, species prefix normalised)
//        -> that event AND ALL ITS ANCESTORS
//        -> each ancestor's literatureReference
//
// The ancestor step is the whole thing: Plant Reactome curates literature at pathway level and
// the genes beneath inherit it. Direct-event-only reproduces 24 of oryza9's 6,695 genes exactly;
// the full closure reproduces 6,268 and covers 6,668 of them. Nothing filters by genome -- the
// rule yields 99,227 gene ids and only 6,831 are gene ids in this site, so the join IS the filter.
//
// Tolerates both of its inputs being missing (passthrough), like vitis_synonym_adder and
// msu6_adder, so it can never break the decorate hot path on a site with no Plant Reactome data.
//
// Idempotent: a pmid already present on the gene with source 'PlantReactome' is never added twice,
// so a full decorate and an incremental patch converge. It does NOT dedupe against plain PUBMED
// xrefs of other provenance -- oryza9 keeps those separate, and `source` is exactly what lets a
// reader tell a Plant Reactome reference from an Ensembl core one.
//
// It only ever PUSHES PUBMED records, so like pubmed_title_adder it is not exposed to the
// ancestor_adder.js `_.keyBy(xrefs,'db')` trap where only the last xref per db survives.
var fs = require('fs');
var path = require('path');
var Q = require('q');
var through2 = require('through2');

var ARTIFACT = process.env.REACTOME_LITERATURE
  || path.join(__dirname, '..', 'reactome', 'reactome_literature.json');
var GENE_EVENTS = process.env.ENSEMBL2REACTOME
  || path.join(__dirname, '..', 'reactome', 'Ensembl2PlantReactomeReactions.txt');

// event -> every publication applicable to it, ancestors folded in once up front. 2,438 events,
// so this is small; the per-gene work is then a lookup and a union.
function closure(lit, parents) {
  var out = {};
  Object.keys(parents).concat(Object.keys(lit)).forEach(function (ev) {
    if (out[ev]) { return; }
    var seen = {}, refs = [];
    [ev].concat(parents[ev] || []).forEach(function (a) {
      (lit[a] || []).forEach(function (r) {
        if (!seen[r.pmid]) { seen[r.pmid] = 1; refs.push(r); }
      });
    });
    if (refs.length) { out[ev] = refs; }
  });
  return out;
}

function load() {
  var deferred = Q.defer();

  if (!fs.existsSync(ARTIFACT) || !fs.existsSync(GENE_EVENTS)) {
    console.error('reactome_literature_adder: ' +
      (!fs.existsSync(ARTIFACT) ? path.basename(ARTIFACT) : path.basename(GENE_EVENTS)) +
      ' missing — skipping');
    deferred.resolve(null);
    return deferred.promise;
  }

  var doc;
  try {
    doc = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
  } catch (e) {
    console.error('reactome_literature_adder: cannot parse ' + ARTIFACT + ' (' + e.message + ') — skipping');
    deferred.resolve(null);
    return deferred.promise;
  }
  var eventRefs = closure(doc.literature || {}, doc.parents || {});
  console.error('reactome_literature_adder: ' + Object.keys(doc.literature || {}).length +
                ' events with literature -> ' + Object.keys(eventRefs).length + ' events after ancestors' +
                ' (artifact fetched ' + (doc.fetched || '?') + ')');

  // gene -> the R-OSA events it participates in. Only events that actually carry literature are
  // kept, which is what makes this table small: 1.3M rows in, a few thousand genes out.
  var geneEvents = {};
  var stream = fs.createReadStream(GENE_EVENTS);
  var rl = require('readline').createInterface({ input: stream, terminal: false });
  stream.on('error', function (e) {
    console.error('reactome_literature_adder: cannot read ' + GENE_EVENTS + ' (' + e.message + ') — skipping');
    rl.close();
    deferred.resolve(null);
  });
  var rows = 0;
  rl.on('line', function (line) {
    if (!line || line[0] === '#') { return; }
    var tab = line.indexOf('\t');
    if (tab < 1) { return; }
    var gene = line.slice(0, tab);
    var rest = line.slice(tab + 1);
    var tab2 = rest.indexOf('\t');
    var ev = tab2 === -1 ? rest : rest.slice(0, tab2);
    if (ev.slice(0, 2) !== 'R-') { return; }
    rows++;
    // Literature lives only on the rice source events; a projected event's `inferredFrom` is the
    // R-OSA event with the same numeric suffix (verified on R-ATH-3899351 -> R-OSA-3899351).
    var osa = 'R-OSA-' + ev.slice(ev.lastIndexOf('-') + 1);
    if (!eventRefs[osa]) { return; }
    var list = geneEvents[gene] || (geneEvents[gene] = []);
    if (list.indexOf(osa) === -1) { list.push(osa); }
  }).on('close', function () {
    console.error('reactome_literature_adder: ' + rows + ' gene/event rows -> ' +
                  Object.keys(geneEvents).length + ' genes with cited events');
    deferred.resolve({ eventRefs: eventRefs, geneEvents: geneEvents });
  });
  return deferred.promise;
}

// The whole transform, exported so an incremental patch applies EXACTLY what a rebuild does --
// the same reason pubmed_title_adder exports fillGene. A patch that writes differently from the
// rebuild is a patch the next decorate silently undoes.
//
// Returns the number of references added. Mutates gene.xrefs.
function addGene(gene, lut) {
  if (!lut || !gene || !gene._id) { return 0; }
  var evs = lut.geneEvents[gene._id];
  if (!evs) { return 0; }

  if (!gene.xrefs) { gene.xrefs = []; }
  var have = {};
  gene.xrefs.forEach(function (x) {
    if (x && x.db === 'PUBMED' && x.source === 'PlantReactome') {
      (x.ids || []).forEach(function (i) { have[String(i)] = 1; });
    }
  });

  var added = 0;
  evs.forEach(function (ev) {
    lut.eventRefs[ev].forEach(function (r) {
      if (have[r.pmid]) { return; }
      have[r.pmid] = 1;
      // One record per paper, so each carries its own title -- the shape oryza9 serves, and the
      // shape rap-db and geneRIF already use. `text` is omitted rather than left empty when Plant
      // Reactome has no title, so pubmed_title_adder can fill it from PubMed instead.
      var rec = { db: 'PUBMED', source: 'PlantReactome', ids: [r.pmid] };
      if (r.title) { rec.text = r.title; }
      gene.xrefs.push(rec);
      added++;
    });
  });
  return added;
}

module.exports = function () {
  var lut = null, ready = false;
  var lutPromise = load().then(function (l) { lut = l; ready = true; return l; });
  var refs = 0, genes = 0;

  return through2.obj(function (gene, enc, done) {
    var self = this;
    function process() {
      var n = addGene(gene, lut);
      if (n) { refs += n; genes++; }
      self.push(gene);
      done();
    }
    // Synchronous once loaded: a per-gene microtask hop can break mongodb@2 backpressure
    // mid-stream (the addQtlXrefs lesson), so only the first few genes wait on the promise.
    if (ready) { process(); } else { lutPromise.then(process); }
  }, function (done) {
    console.error('reactome_literature_adder: added ' + refs + ' Plant Reactome references to ' +
                  genes + ' genes');
    done();
  });
};

module.exports.addGene = addGene;
module.exports.load = load;

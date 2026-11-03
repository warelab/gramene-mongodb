#!/usr/bin/env node

// Shared implementation behind curated.js (the in-house CSHL curation set) and rapdb.js (RAP-DB's
// curated_genes.json). Those two were ~95% identical copies of each other, and the duplication had
// already cost us: the 60s fetch guard was added to curated.js and not to rapdb.js, so the build's
// most fragile fetch -- a mirror on a host we do not control -- was the unguarded one, where a hung
// response stalls the whole decorate pipeline instead of degrading.
//
// Everything that genuinely differs between the two sources is an option:
//   urls         ordered attempt list; the first one that answers wins
//   localFile    read this instead of the network (a tracked in-tree artifact)
//   refTextField the per-reference text field. CSHL calls it `description`, RAP-DB calls it `title`.
//                Getting this wrong yields empty strings rather than an error, so we assert a fill
//                rate and shout.
//   source       the tag written onto each PUBMED xref. The client renders it verbatim in the
//                "Curation source" column of the Curated publications tab.
//   ontologies   which ontology arrays to read off each entry.

var Q = require('q');
var through2 = require('through2');
var _ = require('lodash');

var FETCH_TIMEOUT_MS = 60000;

// Ontology key in the feed -> xref db name. ancestor_adder.js only loads LUTs for GO/PO/TO (plus
// domains/taxonomy), so these are the three a curated term can usefully become. CHEBI was carried
// here once and produced a CHEBI__xrefs field with no name, no ancestors and no hierarchy -- an
// xref shaped like an annotation that was not one -- so it is now disregarded upstream, in
// fetch_cshl_curation.js, where it can be counted and reported to the curators.
var ONTOLOGY_DB = {po: 'PO', to: 'TO', go: 'GO'};

// The GO evidence-code set. Anything outside it is a data-entry error: we fall back rather than
// invent a mapping. Note the curation sheet's 14 "IPP" rows are almost certainly "IPI", but
// silently rewriting a curator's evidence code is worse than reporting it.
var GO_EVIDENCE = {};
('EXP IDA IPI IMP IGI IEP HTP HDA HMP HGI HEP IBA IBD IKR IRD ISS ISO ISA ISM IGC RCA TAS NAS IC ND IEA')
  .split(' ').forEach(function (c) { GO_EVIDENCE[c] = 1; });
var DEFAULT_EVIDENCE = 'IEA';

// Pull the ontology id off one term string. The two sources spell these differently: RAP-DB writes
// "TO:0000401 - plant growth hormone sensitivity", a hand-curated sheet writes a bare "GO:0016120".
// The original code did term.substring(0, term.indexOf(' ')), which returns "" for a bare id and "-"
// for RAP-DB's one malformed term ("- palea pubescence" on Os05g0118700, whose junk "-" id is in the
// live collection today and is silently dropped by ancestor_adder).
function ontologyId(term) {
  if (typeof term !== 'string') return undefined;
  var m = /^([A-Za-z_]+:[0-9]+)/.exec(term.trim());
  return m ? m[1] : undefined;
}

// The feed carries evidence as an ARRAY of codes per term, in the order the curator typed them
// (older artifacts carry a bare string; both are accepted). Only the first is used, because the gene
// doc has exactly one slot: ancestor_adder.js keys usefulInfo by the term's integer id and sets
// evidence_code on it, so a second pair for the same term overwrites rather than accumulates, and
// mergeOntologyXref dedupes on the term alone. Narrowing here, once and on purpose, beats letting an
// arbitrary last-write-wins decide it further down.
function firstEvidence(ec) {
  if (Array.isArray(ec)) return ec.length ? ec[0] : undefined;
  return ec;
}

function normalizeEvidence(code, label, warned) {
  if (!code) return DEFAULT_EVIDENCE;
  var c = String(code).trim().toUpperCase();
  if (GO_EVIDENCE[c]) return c;
  if (!warned[c]) {
    warned[c] = 1;
    console.error(label + ': evidence code "' + c + '" is not a GO evidence code -- using ' +
                  DEFAULT_EVIDENCE + ' and leaving it for the curators');
  }
  return DEFAULT_EVIDENCE;
}

// ancestor_adder.js:30 does _.keyBy(gene.xrefs,'db'), and lodash keyBy keeps only the LAST entry per
// key. So pushing a second xref for a db the gene already has makes the first one invisible. For GO
// that would discard every Ensembl GO term on the gene, and 22,669 rice / 24,176 sorghum / 27,548
// maize genes already carry a GO xref. Merge into the existing xref; push only when there is none.
// A term both sides claim keeps the Ensembl entry, whose evidence code is real rather than inferred.
function mergeOntologyXref(gene, db, pairs) {
  var existing;
  for (var i = 0; i < gene.xrefs.length; i++) {
    if (gene.xrefs[i].db === db) { existing = gene.xrefs[i]; break; }
  }
  if (!existing) {
    gene.xrefs.push({db: db, ids: pairs});
    return pairs.length;
  }
  var have = {};
  (existing.ids || []).forEach(function (id) { have[Array.isArray(id) ? id[0] : id] = 1; });
  var added = 0;
  pairs.forEach(function (p) {
    if (!have[p[0]]) { existing.ids.push(p); have[p[0]] = 1; added++; }
  });
  return added;
}

function fetchJson(urls, label) {
  var attempts = Array.isArray(urls) ? urls.slice() : [urls];
  function tryNext(i) {
    if (i >= attempts.length) {
      console.error(label + ': every source URL failed -- proceeding with an empty LUT');
      return Q.resolve([]);
    }
    var url = attempts[i];
    console.error(label + ' get(' + url + ')');
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, FETCH_TIMEOUT_MS);
    return Q(fetch(url, {signal: ctrl.signal})
      .then(function (res) {
        clearTimeout(timer);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      }))
      .catch(function (err) {
        clearTimeout(timer);
        console.error(label + ' fetch failed for ' + url + ' (' + err.message + ')');
        return tryNext(i + 1);
      });
  }
  return tryNext(0);
}

function readLocalJson(file, label, urls) {
  var deferred = Q.defer();
  require('fs').readFile(file, 'utf8', function (err, body) {
    if (err) {
      console.error(label + ': cannot read ' + file + ' (' + err.message + ')');
      if (urls && urls.length) {
        console.error(label + ': falling back to the network');
        return fetchJson(urls, label).then(deferred.resolve, deferred.resolve);
      }
      return deferred.resolve([]);
    }
    try {
      console.error(label + ' read(' + file + ')');
      deferred.resolve(JSON.parse(body));
    } catch (e) {
      console.error(label + ': ' + file + ' is not valid JSON (' + e.message + ') -- empty LUT');
      deferred.resolve([]);
    }
  });
  return deferred.promise;
}

function buildLut(opts) {
  var label = opts.label || opts.source;
  var ontologies = opts.ontologies || ['po', 'to', 'go'];
  var source = opts.localFile
    ? readLocalJson(opts.localFile, label, opts.urls)
    : fetchJson(opts.urls, label);

  return source.then(function (genes) {
    var lut = {};
    var refsSeen = 0, refsWithText = 0, termCount = 0, badTerms = 0, unkeyedRefs = 0;
    var warnedEvidence = {};
    (genes || []).forEach(function (g) {
      if (!g || !g.locus) return;
      if (!lut.hasOwnProperty(g.locus)) {
        lut[g.locus] = {name: '', synonyms: [], refs: []};
        ontologies.forEach(function (o) { lut[g.locus][o] = {}; });
      }
      var entry = lut[g.locus];

      // Reference keys are not all PMIDs. RAP-DB keys 246 of its references by DOI and a handful by
      // free-text citation. The old test was `_.isNumber(+pmid)`, which is true for NaN, so every
      // DOI sailed through and became a PUBMED xref whose id is a DOI -- 250 rice genes in the live
      // collection carry one today, and the Curated publications tab renders each as a PubMed link
      // to /pubmed/DOI:10.1016/... which is broken. Route by form instead of dropping them.
      _.forEach(g.references, function (ref, key) {
        if (!_.isObject(ref)) {
          unkeyedRefs++;
          return;
        }
        var k = String(key).trim(), db, id;
        if (/^[0-9]+$/.test(k)) { db = 'PUBMED'; id = k; }
        else if (/^DOI:/i.test(k)) { db = 'DOI'; id = k.replace(/^DOI:\s*/i, ''); }
        else { unkeyedRefs++; return; }   // free-text citation: no resolvable identifier
        refsSeen++;
        var text = ref[opts.refTextField];
        if (text) refsWithText++;
        entry.refs.push({id: id, title: text, db: db});
      });

      if (g.gene_symbols) {
        var symbols = String(g.gene_symbols).split(', ').map(function (s) { return s.trim(); })
                        .filter(Boolean);
        // ACCUMULATE across rows for one locus. The original overwrote `name` and REPLACED
        // `synonyms` on every entry, so for a locus with several entries the last row silently won
        // and the earlier rows' symbols were thrown away -- 247 RAP-DB loci and 86 sheet ids.
        if (!entry.name && symbols.length) entry.name = symbols.shift();
        else if (entry.name && symbols.length && symbols[0] === entry.name) symbols.shift();
        entry.synonyms = _.uniq(entry.synonyms.concat(symbols));
      }

      ontologies.filter(function (o) { return g[o]; }).forEach(function (o) {
        g[o].forEach(function (term) {
          var id = ontologyId(term);
          if (!id) {
            badTerms++;
            console.error(label + ': unparseable ontology term', JSON.stringify(term));
            return;
          }
          // Per-term evidence code when the feed carries one (the curation sheet does); otherwise
          // IEA. Never "IDK", which is not an evidence code and which this build shipped on every
          // curated PO/TO annotation until now.
          var ec = g.evidence && firstEvidence(g.evidence[id]);
          entry[o][id] = normalizeEvidence(ec, label, warnedEvidence);
          termCount++;
        });
      });
    });

    // This gate exists to catch a WRONG FIELD NAME, which yields a fill rate near zero -- not
    // curators leaving the function box empty, which is normal and runs about 10% on the CSHL
    // sheet. The threshold was 0.9, which sat directly on that real rate: tightening the
    // wrong-column rule in fetch_cshl_curation.js moved the fill from 1038/1153 to 1053/1176 and
    // tripped it, so the build would have warned about a correct configuration on every run. A
    // warning that cries wolf every time is worse than no warning.
    if (refsSeen > 0 && refsWithText / refsSeen < 0.5) {
      console.error(label + ': WARNING only ' + refsWithText + ' of ' + refsSeen +
                    ' references have text in field "' + opts.refTextField + '" -- is refTextField right?');
    } else if (refsSeen > refsWithText) {
      console.error(label + ': ' + (refsSeen - refsWithText) + ' of ' + refsSeen +
                    ' references carry no curator text (the submitter left it blank)');
    }
    console.error(label + ' lookup table: ' + Object.keys(lut).length + ' loci, ' + refsSeen +
                  ' references, ' + termCount + ' ontology terms (' + badTerms + ' unparseable, ' +
                  unkeyedRefs + ' references with no resolvable PMID or DOI)');
    return lut;
  });
}

module.exports = function (opts) {
  var ontologies = opts.ontologies || ['po', 'to', 'go'];
  var lutPromise = buildLut(opts);

  return through2.obj(function (gene, enc, done) {
    var that = this;

    if (!_.isObject(gene)) {
      throw new Error('gene is lacking needed info');
    }

    lutPromise.then(function (lut) {
      var hit = lut[gene._id];
      if (hit) {
        if (gene.name === gene._id && hit.name) {
          gene.name = hit.name;
        }
        if (hit.synonyms && hit.synonyms.length) {
          // MERGE, don't replace: a single-symbol curated/rapdb entry yields synonyms=[] (truthy),
          // and replacing would wipe synonyms added upstream (e.g. fix_sorghum_v2 Sb./Sobic. ids).
          gene.synonyms = _.uniq((gene.synonyms || []).concat(hit.synonyms));
        }
        if (hit.refs) {
          hit.refs.forEach(function (ref) {
            gene.xrefs.push({
              db: ref.db || 'PUBMED',
              source: opts.source,
              text: ref.title,
              ids: [ref.id]
            });
          });
        }
        ontologies.forEach(function (o) {
          var terms = Object.keys(hit[o]);
          if (terms.length > 0) {
            mergeOntologyXref(gene, ONTOLOGY_DB[o] || o.toUpperCase(),
              terms.map(function (t) { return [t, hit[o][t]]; }));
          }
        });
      }
      that.push(gene);
      done();
    });
  });
};

module.exports.ontologyId = ontologyId;
module.exports.mergeOntologyXref = mergeOntologyXref;
module.exports.normalizeEvidence = normalizeEvidence;
module.exports.buildLut = buildLut;

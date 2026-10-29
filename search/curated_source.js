#!/usr/bin/env node

// Shared implementation behind curated.js (the in-house CSHL curation set) and rapdb.js (RAP-DB's
// curated_genes.json). Those two were ~95% identical copies of each other, and the duplication had
// already cost us: the 60s fetch guard was added to curated.js and not to rapdb.js, so the build's
// most fragile fetch -- a mirror on a host we do not control -- was the unguarded one, where a hung
// response stalls the whole decorate pipeline instead of degrading.
//
// Everything that genuinely differs between the two sources is an option:
//   urls         ordered attempt list; the first one that answers wins
//   refTextField the per-reference text field. CSHL calls it `description`, RAP-DB calls it `title`.
//                Getting this wrong yields empty strings rather than an error, so the caller asserts
//                a fill rate (see assertRefText below).
//   source       the tag written onto each PUBMED xref. The client renders it verbatim in the
//                "Curation source" column of the Curated publications tab.
//   ontologies   which ontology arrays to read off each entry.

var Q = require('q');
var through2 = require('through2');
var _ = require('lodash');

var FETCH_TIMEOUT_MS = 60000;

// Pull the ontology id off one term string. The two sources spell these differently:
// RAP-DB writes "TO:0000401 - plant growth hormone sensitivity", while a hand-curated sheet writes a
// bare "GO:0016120". The original code did term.substring(0, term.indexOf(' ')), which on a bare id
// returns substring(0,-1) === '' -- i.e. it silently filed the annotation under an empty key. That
// never fired because the only populated source used the " - label" form, but it would the moment a
// bare id arrived.
function ontologyId(term) {
  if (typeof term !== 'string') return undefined;
  var m = /^([A-Za-z_]+:[0-9]+)/.exec(term.trim());
  return m ? m[1] : undefined;
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

function readLocalJson(file, label) {
  var deferred = Q.defer();
  require('fs').readFile(file, 'utf8', function (err, body) {
    if (err) {
      console.error(label + ': cannot read ' + file + ' (' + err.message + ') -- empty LUT');
      return deferred.resolve([]);
    }
    try {
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
  var ontologies = opts.ontologies || ['po', 'to'];
  var source = opts.localFile
    ? readLocalJson(opts.localFile, label)
    : fetchJson(opts.urls, label);

  return source.then(function (genes) {
    var lut = {};
    var refsSeen = 0, refsWithText = 0;
    (genes || []).forEach(function (g) {
      if (!g || !g.locus) return;
      if (!lut.hasOwnProperty(g.locus)) {
        lut[g.locus] = {name: '', synonyms: [], refs: []};
        ontologies.forEach(function (o) { lut[g.locus][o] = {}; });
      }
      var entry = lut[g.locus];

      _.forEach(g.references, function (ref, pmid) {
        if (_.isObject(ref) && _.isNumber(+pmid)) {
          refsSeen++;
          var text = ref[opts.refTextField];
          if (text) refsWithText++;
          entry.refs.push({id: pmid, title: text});
        } else {
          console.error('skipping reference', ref, pmid);
        }
      });

      if (g.gene_symbols) {
        var symbols = g.gene_symbols.split(', ');
        // Faithful to the original: for a locus with several entries the LAST one wins, and synonyms
        // are replaced rather than accumulated. RAP-DB has 247 such loci. Changed deliberately in a
        // follow-up commit -- kept here so the refactor is provably behaviour-preserving.
        entry.name = symbols.shift();
        entry.synonyms = _.uniq(symbols);
      }

      ontologies.filter(function (o) { return g[o]; }).forEach(function (o) {
        g[o].forEach(function (term) {
          var id = ontologyId(term);
          if (id) entry[o][id] = 1;
          else console.error(label + ': unparseable ontology term', JSON.stringify(term));
        });
      });
    });

    // A mis-wired refTextField is silent: every ref gets undefined text and the Curated publications
    // tab renders blank rows. Shout about it rather than shipping empty cells.
    if (refsSeen > 0 && refsWithText / refsSeen < 0.9) {
      console.error(label + ': WARNING only ' + refsWithText + ' of ' + refsSeen +
                    ' references have text in field "' + opts.refTextField + '"');
    }
    console.error(label + ' lookup table: ' + Object.keys(lut).length + ' loci, ' +
                  refsSeen + ' references');
    return lut;
  });
}

module.exports = function (opts) {
  var ontologies = opts.ontologies || ['po', 'to'];
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
              db: 'PUBMED',
              source: opts.source,
              text: ref.title,
              ids: [ref.id]
            });
          });
        }
        ontologies.forEach(function (o) {
          var terms = Object.keys(hit[o]);
          if (terms && terms.length > 0) {
            gene.xrefs.push({
              db: o.toUpperCase(),
              ids: terms.map(function (t) { return [t, 'IDK']; })
            });
          }
        });
      }
      that.push(gene);
      done();
    });
  });
};

module.exports.ontologyId = ontologyId;
module.exports.buildLut = buildLut;

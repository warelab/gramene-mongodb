#!/usr/bin/env node

// MaizeGDB curated gene names for Zea mays B73 v5.
//
// r69 had search/maizeGDB.js reading maizegdb_genes_all.txt -- 20,812 maize genes with symbol, full
// name and a provenance column including 425 Classical Genes. In r70 the same variable, fixMaizeV4,
// was repointed at fix_maize_v5.js, which reads a 13,941-row 3-column file with no provenance. Maize
// lost ~7,000 symbols and any record of which of its names were curated and by whom. There is no
// MaizeGDB xref anywhere in the collection today (0 records), and the Grassius xref that does exist
// on 3,707 maize genes holds a TF FAMILY name, not a gene symbol.
//
// Input: maizegdb_go.csv.gz from
//   https://download.maizegdb.org/Zm-B73-REFERENCE-NAM-5.0/Zm-B73-REFERENCE-NAM-5.0-GMs-GOTerms.csv.gz
// keyed natively on Zm00001eb*, which is exactly this build's maize gene set -- 44,303 distinct
// gene_models against 44,303 zea_mays genes, so no id mapping is involved.
//
// WHAT THIS DOES NOT LOAD: the file's obo_terms column carries GO for 30,481 rows, but with no
// evidence codes and no stated provenance, and MaizeGDB publishes its explicitly computational GO
// (Maize-GAMER, Pannzer, ProtNLM) separately. Importing it here would file unattributed,
// probably-computational GO under a curation banner and inflate the GO facet by ~3,000 genes that
// have none today. The curated payload in this file is the gene-name registry, and that is what we
// take. Loading the GO is a deliberate, separate decision.

var Q = require('q');
var through2 = require('through2');
var _ = require('lodash');
var zlib = require('zlib');
var fs = require('fs');

var FILENAME = 'maizegdb_go.csv.gz';

var EXPECTED_HEADER = ['gene_model','assembly_version','annotation_version','gene_model_chr',
  'gene_model_start','gene_model_end','transcript_count','canonical_transcript_name','tandem_count',
  'transcript_chr','transcript_start','transcript_end','locus_symbol','locus_name','gene_products',
  'obo_terms','obo_names'];
var COL = {GENE: 0, SYMBOL: 12, NAME: 13, PRODUCTS: 14};

// RFC 4180. Absent values are the bare unquoted token NULL, which a naive parser hands back as the
// 4-character string "NULL" rather than empty -- hence nullable() below.
function parseCsv(text) {
  var rows = [], row = [], field = '', inQuotes = false, wasQuoted = false;
  for (var i = 0; i < text.length; i++) {
    var ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true; wasQuoted = true;
    } else if (ch === ',') {
      row.push(wasQuoted ? field : nullable(field)); field = ''; wasQuoted = false;
    } else if (ch === '\n') {
      row.push(wasQuoted ? field : nullable(field)); field = ''; wasQuoted = false;
      rows.push(row); row = [];
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field.length || row.length) { row.push(wasQuoted ? field : nullable(field)); rows.push(row); }
  return rows.filter(function (r) { return r.length > 1; });
}
function nullable(v) { return v === 'NULL' ? undefined : v; }

// PostgreSQL array literal: {a,b,"c, with comma","d ""quoted"""}. Elements are quoted only when
// they contain a comma, and an inner quote is doubled. A naive split(',') shreds every label that
// contains a comma -- and GO labels routinely do ("DNA-templated transcription, termination").
function parsePgArray(v) {
  if (v === undefined || v === null || v === '' || v === 'NULL') return [];
  var s = String(v);
  if (s.charAt(0) === '{' && s.charAt(s.length - 1) === '}') s = s.slice(1, -1);
  var out = [], cur = '', inQuotes = false;
  for (var i = 0; i < s.length; i++) {
    var ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      if (cur !== '') out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur !== '') out.push(cur);
  return out;
}

// Roughly half of locus_symbol is not a curated symbol: the gene model id repeated, a legacy
// Zm00001d* v4 id, a marker name (bnlg149, pco082477), a RefSeq LOC id, or a UniProt accession.
// locus_name being present is what distinguishes a curated entry, so that is the filter -- but
// screen the symbol too, so a curated row with a placeholder symbol does not overwrite a real name.
function looksLikePlaceholder(symbol, geneId) {
  if (!symbol) return true;
  if (symbol === geneId) return true;
  if (/^Zm[0-9]{5}[a-z]{1,2}[0-9]+$/.test(symbol)) return true;   // any Zm gene-model id
  if (/^LOC[0-9]+$/.test(symbol)) return true;                     // RefSeq
  // UniProt's own accession pattern, both the 6-char (Q0WV96) and 10-char (A0A1D6DW15) forms.
  if (/^([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2})$/.test(symbol)) return true;
  return false;
}

function getMapping() {
  var deferred = Q.defer();
  fs.readFile(FILENAME, function (err, gz) {
    if (err) {
      // Degrade to passthrough rather than killing a 5h30m decorate run. vitis_synonym_adder.js
      // documents why this guard is not optional.
      console.error('maizegdb: cannot read ' + FILENAME + ' (' + err.message +
                    ') -- maize curated names will be absent from this build');
      return deferred.resolve({});
    }
    zlib.gunzip(gz, function (gzErr, buf) {
      if (gzErr) {
        console.error('maizegdb: ' + FILENAME + ' will not gunzip (' + gzErr.message +
                      ') -- proceeding without maize curated names');
        return deferred.resolve({});
      }
      var rows = parseCsv(buf.toString('utf8'));
      var header = (rows[0] || []).map(function (h) { return String(h).trim(); });
      var mismatch = header.length !== EXPECTED_HEADER.length ||
        EXPECTED_HEADER.some(function (h, i) { return h !== header[i]; });
      if (mismatch) {
        console.error('maizegdb: HEADER CHANGED -- refusing to parse, a shifted column set would ' +
                      'silently write wrong names.\n  expected ' + JSON.stringify(EXPECTED_HEADER) +
                      '\n  found    ' + JSON.stringify(header));
        return deferred.resolve({});
      }
      var lut = {}, curated = 0, placeholders = 0;
      rows.slice(1).forEach(function (r) {
        var id = r[COL.GENE];
        if (!id) return;
        var name = r[COL.NAME];
        if (!name) return;                       // locus_name NULL -> not a curated entry
        curated++;
        var symbol = r[COL.SYMBOL];
        if (looksLikePlaceholder(symbol, id)) { placeholders++; symbol = undefined; }
        lut[id] = {
          symbol: symbol,
          name: name,
          products: parsePgArray(r[COL.PRODUCTS])
        };
      });
      console.error('maizegdb: ' + (rows.length - 1) + ' rows, ' + curated +
                    ' with a curated locus_name, ' + placeholders +
                    ' of those carrying a placeholder symbol');
      deferred.resolve(lut);
    });
  });
  return deferred.promise;
}

module.exports = function () {
  var lutPromise = getMapping();

  return through2.obj(function (gene, enc, done) {
    var that = this;

    if (!_.isObject(gene)) {
      throw new Error('gene is lacking needed info');
    }

    lutPromise.then(function (lut) {
      var hit = lut[gene._id];
      if (hit) {
        // Guarded, unlike fix_maize_v5.js, which overwrites name unconditionally. This adder runs
        // AFTER fix_maize_v5 precisely because of that: placed before it, every curated name here
        // would be clobbered. After it, maize_gene_info.txt keeps priority for the 13,941 genes it
        // knows -- the same "curated wins, source only adds" stance as 28_grassius_source -- and
        // MaizeGDB fills the rest.
        if (gene.name === gene._id && hit.symbol) {
          gene.name = hit.symbol;
        }
        var syns = [];
        if (hit.symbol && hit.symbol !== gene.name) syns.push(hit.symbol);
        hit.products.forEach(function (p) { if (p) syns.push(p); });
        if (syns.length) {
          gene.synonyms = _.uniq((gene.synonyms || []).concat(syns));
        }
        // fix_maize_v5.js blanks description for every taxon 4577 gene it does not know, so this
        // restores one wherever MaizeGDB has a curated name.
        if (!gene.description && hit.name) {
          gene.description = hit.name;
        }
        // The provenance record that r70 lost entirely. NB: nothing renders this yet -- the client's
        // gramene-dbxrefs registry knows 24 of the collection's 107 xref dbs and MaizeGDB is not one
        // of them, so this reaches the API but not the Cross-references tab until that separate repo
        // is updated.
        gene.xrefs.push({
          db: 'MaizeGDB',
          ids: [hit.symbol || gene._id]
        });
      }
      that.push(gene);
      done();
    });
  });
};

module.exports.parsePgArray = parsePgArray;
module.exports.looksLikePlaceholder = looksLikePlaceholder;

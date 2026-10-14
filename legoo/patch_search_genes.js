#!/usr/bin/env node
/* patch_search_genes.js -- apply LeGOO annotation to <db>.genes after 50_genes_decorate.
 *
 * WHY PATCH RATHER THAN RE-DECORATE
 * gene.display_xref_id and gene.description are read by 40_genes_dump, so the search index does
 * not see the LeGOO load until medicago is re-dumped and decorated. That costs hours on 16.1M
 * genes for the sake of 4,399 documents. This patches those documents directly and lets 60_solr
 * index them. Because sql/03_legoo_load.sql updates the core too, the next full rebuild
 * regenerates the identical values from source -- so this creates no drift, and re-dumping later
 * is a no-op rather than a conflict.
 *
 * WHAT IT WRITES, and why it matches the core exactly
 *   name         the LeGOO acronym, ONLY where the document has no real name. load.js falls back
 *                to the stable id when a gene has no display_xref, so "no real name" is
 *                name === _id. This mirrors 03_legoo_load.sql setting display_xref_id only where
 *                it is NULL.
 *   description  '<desc> [Source:LeGOO;Acc:<acronym>]' -- byte-identical to what the core SQL
 *                writes, so a re-dump produces the same string. mongo2solr strips the
 *                ' [Source:...]' suffix for display, so the browser shows the bare description.
 *   synonyms     the alternative acronyms LeGOO packs into one cell ('MtLb4|MtLb1|MtLb2'), plus
 *                the acronym itself for the 202 genes that keep their existing name -- so the
 *                curated symbol is still searchable there. mongo2solr maps this to the
 *                multiValued solr 'synonyms' field.
 *
 * Idempotent by construction: every predicate also accepts the value this script would have
 * written, so a second run reports 0 changes rather than double-applying or failing.
 *
 * usage: node patch_search_genes.js [--dry-run] [--db search70] [--tsv legoo_genes.tsv]
 */
'use strict';

var fs = require('fs');
var path = require('path');
var MongoClient = require('mongodb').MongoClient;

var argv = process.argv.slice(2);
function opt(flag, dflt) {
  var i = argv.indexOf(flag);
  return i === -1 ? dflt : argv[i + 1];
}
var DRY = argv.indexOf('--dry-run') !== -1;
var DB = opt('--db', process.env.MONGO_DB || 'search70');
var URL = process.env.MONGO_URL || 'mongodb://localhost:27017';
var TSV = opt('--tsv', path.join(__dirname, 'legoo_genes.tsv'));
var BATCH = 500;

function log() {
  console.error.apply(console, arguments);
}

function readTsv(file) {
  var out = [];
  var lines = fs.readFileSync(file, 'utf8').split('\n');
  for (var i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) { continue; }
    var f = lines[i].split('\t');
    var names = (f[2] || '').split('|').map(function (s) { return s.trim(); })
                  .filter(function (s) { return s; });
    if (!names.length) { continue; }
    out.push({
      _id: f[0],
      name: names[0],
      synonyms: names.slice(1),
      description: (f[3] || '').trim()
    });
  }
  return out;
}

(async function main() {
  var rows = readTsv(TSV);
  log('LeGOO rows: %d', rows.length);
  if (!rows.length) { throw new Error('no rows in ' + TSV); }

  var client = await MongoClient.connect(URL);
  var genes = client.db(DB).collection('genes');

  var total = await genes.estimatedDocumentCount();
  log('%s.genes holds ~%d documents', DB, total);

  var stat = {
    missing: 0, nameSet: 0, nameKept: 0, descSet: 0, descKept: 0,
    synAdded: 0, unchanged: 0
  };
  var ops = [];
  var examples = [];

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    // _id is the collection's key, so this is an indexed point lookup -- safe to do 4,399 times
    // even while something else is writing.
    var doc = await genes.findOne({_id: r._id}, {projection: {name: 1, description: 1, synonyms: 1}});
    if (!doc) { stat.missing++; continue; }

    var set = {};
    var addSyn = r.synonyms.slice();

    var hasRealName = doc.name && doc.name !== r._id && doc.name !== r.name;
    if (hasRealName) {
      stat.nameKept++;
      addSyn.push(r.name);           // keep the curated symbol searchable
    } else if (doc.name !== r.name) {
      set.name = r.name;
      stat.nameSet++;
    }

    if (r.description) {
      var target = r.description + ' [Source:LeGOO;Acc:' + r.name + ']';
      var cur = doc.description;
      var empty = !cur || cur === 'unknown' || cur === 'None' || cur === r._id;
      if (cur === target) {
        /* already applied */
      } else if (empty) {
        set.description = target;
        stat.descSet++;
      } else {
        stat.descKept++;
      }
    }

    var have = Array.isArray(doc.synonyms) ? doc.synonyms : [];
    var want = addSyn.filter(function (s) { return have.indexOf(s) === -1; });
    // de-duplicate within this gene's own list too
    want = want.filter(function (s, k) { return want.indexOf(s) === k; });

    if (!Object.keys(set).length && !want.length) { stat.unchanged++; continue; }

    var update = {};
    if (Object.keys(set).length) { update.$set = set; }
    if (want.length) { update.$addToSet = {synonyms: {$each: want}}; stat.synAdded += want.length; }
    ops.push({updateOne: {filter: {_id: r._id}, update: update}});
    if (examples.length < 5) {
      examples.push(r._id + '  ' + JSON.stringify(update));
    }

    if (!DRY && ops.length >= BATCH) {
      await genes.bulkWrite(ops, {ordered: false});
      ops = [];
    }
    if ((i + 1) % 1000 === 0) { log('  %d/%d examined', i + 1, rows.length); }
  }

  if (!DRY && ops.length) {
    await genes.bulkWrite(ops, {ordered: false});
  }

  log('');
  log('documents not found in %s.genes: %d', DB, stat.missing);
  log('name set from LeGOO:            %d', stat.nameSet);
  log('name kept (already had one):    %d', stat.nameKept);
  log('description set:                %d', stat.descSet);
  log('description kept (had one):     %d', stat.descKept);
  log('synonym values added:           %d', stat.synAdded);
  log('already up to date:             %d', stat.unchanged);
  log('');
  if (examples.length) {
    log('sample updates:');
    examples.forEach(function (e) { log('  ' + e); });
    log('');
  }

  if (DRY) {
    log('--dry-run: nothing written');
  } else {
    // verify by reading back, not by trusting the write
    var named = 0, described = 0, syn = 0;
    for (var j = 0; j < rows.length; j += 1) {
      var d = await genes.findOne({_id: rows[j]._id},
                                  {projection: {name: 1, description: 1, synonyms: 1}});
      if (!d) { continue; }
      if (d.name === rows[j].name) { named++; }
      if (d.description && d.description.indexOf('[Source:LeGOO;') !== -1) { described++; }
      if (Array.isArray(d.synonyms) && d.synonyms.length) { syn++; }
    }
    log('VERIFIED by read-back:');
    log('  docs whose name is the LeGOO acronym: %d', named);
    log('  docs with a LeGOO description:        %d', described);
    log('  docs with a non-empty synonyms array: %d', syn);
    if (stat.missing) {
      log('');
      log('NOTE: %d genes were absent. If 50_genes_decorate is still running, wait for it to', stat.missing);
      log('      finish and re-run -- this script is idempotent.');
    }
  }

  await client.close();
})().catch(function (err) {
  log('FAILED: %s', err && err.stack || err);
  process.exit(1);
});

#!/usr/bin/env node
// parseData.js <experiment TSV>...
//
// Loads EBI Atlas per-experiment expression TSVs into the `expression` collection.
//
// The collection is keyed on GENE id with one field per experiment:
//   { _id: "AT1G01010", "E-CURD-1": [...], "E-CURD-29": [...], ... }
// so loading an experiment is semantically "$set one field on the genes it covers". This used to
// accumulate every gene of every TSV in memory and finish with a single insertMany, which (a)
// needed a ~48G heap and (b) forced 55_atlas to DROP the collection first, because a second load
// would collide on _id. It now upserts per experiment, which makes the full path idempotent and
// lets `make add-studies` load one new study without touching anything else.
//
// Files are processed one at a time: peak memory is one experiment, not all of them.
var path = require('path');
var fs = require('fs');
var readline = require('readline');
var collections = require('gramene-mongodb-config');

var tsvFiles = process.argv.slice(2);
if (!tsvFiles.length) {
  console.error('usage: parseData.js <experiment TSV>...');
  process.exit(2);
}

var BATCH = +(process.env.EXPR_BATCH || 2000);   // bulkWrite ops per round trip

// Parse one TSV into { geneId: samples }. Semantics unchanged from the original.
function parseTsv(tsv) {
  return new Promise(function (resolve, reject) {
    var base = path.basename(tsv);
    var DEmode = base.includes('-analytics');
    // basename, so a caller passing a path cannot silently produce a path-prefixed field name
    var exp_id = base.replace(DEmode ? '-analytics.tsv' : '-tpms.tsv', '');
    var fieldNames = [];
    var genes = {};
    readline.createInterface({ input: fs.createReadStream(tsv), terminal: false })
      .on('line', function (line) {
        var fields = line.split("\t");
        if (fieldNames.length === 0) {
          if (fields[0] === "Gene ID" || fields[0] === "GeneID") {
            fields.forEach(function (f) { fieldNames.push(f.replace(/\.p-value$/, '')); });
          }
          return;
        }
        var samples = [];
        var i;
        if (DEmode) {
          for (i = 2; i < fields.length; i += 2) {
            if (fields[i] !== "NA") {
              samples.push({ group: fieldNames[i], p_value: +fields[i], l2fc: +fields[i + 1] });
            }
          }
        } else {
          for (i = 2; i < fields.length; i++) {
            if (fields[i]) {
              var five = fields[i].split(',');
              samples.push({ group: fieldNames[i], value: +five[2] });
            }
          }
        }
        genes[fields[0]] = samples;
      })
      .on('error', reject)
      .on('close', function () { resolve({ exp_id: exp_id, genes: genes }); });
  });
}

// $set this experiment's field on each gene, upserting genes we have not seen before.
function upsert(collection, exp_id, genes) {
  var ids = Object.keys(genes);
  var i = 0;
  function next() {
    if (i >= ids.length) return Promise.resolve(ids.length);
    var slice = ids.slice(i, i + BATCH);
    i += BATCH;
    var ops = slice.map(function (id) {
      var set = {};
      set[exp_id] = genes[id];
      return { updateOne: { filter: { _id: id }, update: { $set: set }, upsert: true } };
    });
    return new Promise(function (resolve, reject) {
      collection.bulkWrite(ops, { ordered: false }, function (err) { err ? reject(err) : resolve(); });
    }).then(next);
  }
  return next();
}

collections.expression.mongoCollection().then(function (expressionCollection) {
  var total = 0;
  return tsvFiles.reduce(function (chain, tsv) {
    return chain.then(function () {
      return parseTsv(tsv).then(function (r) {
        var n = Object.keys(r.genes).length;
        if (!n) { console.error('  ' + r.exp_id + ': no data rows — skipped'); return; }
        return upsert(expressionCollection, r.exp_id, r.genes).then(function () {
          total += n;
          console.error('  ' + r.exp_id + ': ' + n + ' genes upserted');
        });
      });
    });
  }, Promise.resolve()).then(function () {
    console.error('finished loading expression (' + tsvFiles.length + ' experiment(s), ' + total + ' gene-writes)');
    collections.closeMongoDatabase();
  });
}).catch(function (e) {
  console.error('parseData FAILED: ' + (e && e.message || e));
  process.exit(1);
});

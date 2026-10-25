#!/usr/bin/env node
// verify_tree_shape.js — gate for 35_genetrees: are the stored trees in the flat shape, and does
// that shape still rebuild into exactly what the API is supposed to serve?
//
// usage: node verify_tree_shape.js <tree_set> [sample_size]
//        node verify_tree_shape.js --deep-report
//
// Exits non-zero with a message on the first problem, so the stage can die on it.
//
// This exists because the storage model changed under the /genetrees contract. The endpoint
// returns the stored document rebuilt by tree_shape, so a conversion that is subtly not an
// inverse would corrupt every tree response while every count in the build still looked right --
// the same shape of failure as the 147 trees that went missing without anything noticing.
'use strict';
var collections = require('gramene-mongodb-config');
var shape = require('gramene-mongodb-config/tree_shape');

var DEEP_LIMIT = 112;   // measured: depth 111 stores, 115 is rejected for nested-object depth

function fail(msg) { console.error('verify_tree_shape: ' + msg); process.exitCode = 1; }

(async function main() {
  var coll = await collections.genetrees.mongoCollection();

  if (process.argv[2] === '--deep-report') {
    // What the whole redesign was for: trees the nested shape could not have stored at all.
    // Reported rather than asserted per set, because rice legitimately has none.
    var sets = (await coll.distinct('tree_set')).filter(Boolean).sort();
    var totalDeep = 0;
    for (var i = 0; i < sets.length; i++) {
      var n = await coll.count({ tree_set: sets[i], max_depth: { $gt: DEEP_LIMIT } });
      totalDeep += n;
      console.log('  ' + sets[i] + ': ' + n + ' trees deeper than ' + DEEP_LIMIT + ' levels');
    }
    console.log('  total: ' + totalDeep + ' trees that the nested shape could not have stored');
    if (!totalDeep) {
      fail('no tree anywhere is deeper than ' + DEEP_LIMIT + ' levels. Release 70 had 147 of them,' +
           ' so either the deep trees are being dropped again or max_depth is not being written.');
    }
    collections.closeMongoDatabase();
    return;
  }

  var treeSet = process.argv[2];
  var sampleSize = parseInt(process.argv[3] || '50', 10);
  if (!treeSet) { fail('usage: verify_tree_shape.js <tree_set> [sample_size]'); collections.closeMongoDatabase(); return; }

  var docs = await coll.aggregate([{ $match: { tree_set: treeSet } },
                                   { $sample: { size: sampleSize } }],
                                  { allowDiskUse: true }).toArray();
  if (!docs.length) { fail("no trees found for tree_set '" + treeSet + "'"); collections.closeMongoDatabase(); return; }

  var nested = 0, bad = 0, deepest = 0, biggest = 0;
  for (var d = 0; d < docs.length; d++) {
    var doc = docs[d];
    if (!doc.nodes) {
      nested++;
      continue;   // counted and reported below, not silently tolerated
    }
    var diff = shape.storedRoundTripDiff(doc);
    if (diff) {
      bad++;
      if (bad === 1) { fail("tree '" + doc._id + "' does not survive a round trip: " + diff); }
    }
    if ((doc.max_depth || 0) > deepest) { deepest = doc.max_depth; }
    if (doc.nodes.length > biggest) { biggest = doc.nodes.length; }
  }

  if (nested) {
    fail(nested + ' of ' + docs.length + " sampled '" + treeSet + "' trees are still in the NESTED" +
         ' shape. genetree.js should be writing flat; a nested tree deeper than ' + DEEP_LIMIT +
         ' levels cannot be stored at all.');
  }
  if (!bad && !nested) {
    console.log('  ' + treeSet + ': ' + docs.length + ' sampled trees are flat and round trip exactly'
                + ' (deepest ' + deepest + ' levels, largest ' + biggest + ' nodes)');
  }
  collections.closeMongoDatabase();
})().catch(function (e) { fail('threw: ' + (e && e.message)); });

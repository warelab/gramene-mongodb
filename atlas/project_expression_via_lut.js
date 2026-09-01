#!/usr/bin/env node
// project_expression_via_lut.js [--only ACC,ACC] <new_old.lut.txt>
//
// The Atlas keys some species' expression by an OLD assembly's gene ids (poplar POPTR_*, grapevine
// VIT_, barley HORVU1Hr1) while this build's genes use the new ids (Potri.*, Vitvi*,
// HORVU.MOREX.r3). The LUT is <new_id>\t<old_id>; this copies each old-keyed expression document
// onto its new gene id(s) so it attaches in mongo2solr.
//
// Now upsert-based ($set of the experiment fields) rather than insertMany, so it is idempotent:
// it no longer has to run exactly once against a freshly dropped collection, and an incremental
// run can project just the newly added experiments with --only.
//
// Streams a cursor instead of find({}).toArray() — the old version pulled all 365k expression
// documents into memory at once.
var fs = require('fs');
var readline = require('readline');
var collections = require('gramene-mongodb-config');

var args = process.argv.slice(2);
var only = null;
var oi = args.indexOf('--only');
if (oi !== -1) {
  only = new Set(String(args[oi + 1] || '').split(/[,\s]+/).filter(Boolean));
  args.splice(oi, 2);
}
var lutFile = args.pop();
if (!lutFile) { console.error('usage: project_expression_via_lut.js [--only ACC,ACC] <lut>'); process.exit(2); }

var BATCH = +(process.env.EXPR_BATCH || 2000);
var lut = {};   // old_id -> [new_id, ...]

readline.createInterface({ input: fs.createReadStream(lutFile), terminal: false })
  .on('line', function (line) {
    var f = line.split("\t");
    if (f.length < 2) return;
    (lut[f[1]] = lut[f[1]] || []).push(f[0]);
  })
  .on('close', function () {
    console.error('loaded ' + Object.keys(lut).length + ' old->new gene id mappings from ' + lutFile +
                  (only ? ' (projecting only: ' + [...only].join(',') + ')' : ''));
    collections.expression.mongoCollection().then(function (col) {
      var cursor = col.find({});
      var ops = [], projected = 0, scanned = 0;

      function flush() {
        if (!ops.length) return Promise.resolve();
        var batch = ops; ops = [];
        return new Promise(function (resolve, reject) {
          col.bulkWrite(batch, { ordered: false }, function (err) { err ? reject(err) : resolve(); });
        });
      }

      function step() {
        return new Promise(function (resolve, reject) {
          cursor.next(function (err, doc) { err ? reject(err) : resolve(doc); });
        }).then(function (doc) {
          if (!doc) return flush().then(function () { return true; });
          scanned++;
          var targets = lut[doc._id];
          if (targets) {
            // the experiment fields to copy across (everything but the key)
            var set = {};
            var any = false;
            Object.keys(doc).forEach(function (k) {
              if (k === '_id') return;
              if (only && !only.has(k)) return;
              set[k] = doc[k]; any = true;
            });
            if (any) {
              targets.forEach(function (new_id) {
                ops.push({ updateOne: { filter: { _id: new_id }, update: { $set: set }, upsert: true } });
                projected++;
              });
            }
          }
          return (ops.length >= BATCH ? flush() : Promise.resolve()).then(step);
        });
      }

      return step().then(function () {
        console.error('remapped expression onto ' + projected + ' gene id(s) (scanned ' + scanned + ')');
        collections.closeMongoDatabase();
      });
    }).catch(function (e) {
      console.error('project_expression_via_lut FAILED: ' + (e && e.message || e));
      process.exit(1);
    });
  });

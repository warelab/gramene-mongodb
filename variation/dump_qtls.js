#!/usr/bin/env node
var collections = require('gramene-mongodb-config');
var variation_dbs = require('../ensembl_db_info.json').variations || [];
var Q = require('q');

// connect to mysql database
var mysql = require('mysql');

var sql= 'select s.name as source, pf.object_id as qtl_feature, p.description, po.accession as term, sr.name as region, pf.seq_region_start start, pf.seq_region_end end'
 + ' from source s, phenotype_feature pf, phenotype p, phenotype_ontology_accession po, seq_region sr'
 + ' where pf.type="QTL" and pf.source_id = s.source_id and pf.phenotype_id = p.phenotype_id and p.phenotype_id = po.phenotype_id and pf.seq_region_id = sr.seq_region_id';

get_qtls().then(function(qtls) {
  console.error('got_qtls',qtls.length);
  collections.qtls.mongoCollection().then(function(mongoQTLs) {
    if (!qtls.length) {                       // insertMany([]) throws "Batch cannot be empty"
      console.log("no QTLs to load");
      collections.closeMongoDatabase();
      return;
    }
    mongoQTLs.insertMany(qtls, function(err, result) {
      if (err) {
        throw err;
      }
      console.log("finished loading QTLs");
      collections.closeMongoDatabase();
    })
  })
}).catch(function(err) {
  console.error("dump_qtls failed:", err && err.message || err);
  process.exit(1);
});

function get_qtls() {
  var deferred = Q.defer();
  collections.maps.mongoCollection().then(function(mongoMaps) {
    mongoMaps.find().toArray(function(err, docs) {
      if (err) { deferred.reject(err); return; }
      var qtls = [];
      var toterms = {};
      var mapLUT = {};
      console.error("got docs from maps");
      docs.forEach(function(map) {
        mapLUT[map.system_name] = map._id;
      })

      // Load QTLs from each variation db resiliently. The old code opened all N connections at once
      // and any single `connect ETIMEDOUT` threw fatally, aborting the whole dump (same fragility as
      // maps/load.js). Now: throttle to MAX_CONC concurrent dbs, give each a 30s connectTimeout, and
      // retry a transient connect failure before giving up. Accumulation (qtls/toterms/mapLUT) is
      // unchanged; dbs with no QTLs simply return 0 rows.
      var MAX_CONC = 4;
      var TRANSIENT = { ETIMEDOUT:1, ECONNREFUSED:1, PROTOCOL_CONNECTION_LOST:1, ECONNRESET:1, EPIPE:1, PROTOCOL_SEQUENCE_TIMEOUT:1 };

      function processDb(variation_db) {
        var system_name = variation_db.database.split('_variation_')[0];
        return new Promise(function(resolve, reject) {
          var attempt = 0;
          (function tryConnect() {
            attempt++;
            var settled = false;
            var conn = mysql.createConnection(Object.assign({ connectTimeout: 30000 }, variation_db));
            conn.on('error', function() {});  // swallow stray async errors; handled explicitly below
            conn.connect(function(connErr) {
              if (connErr) {
                try { conn.destroy(); } catch (e) {}
                if (TRANSIENT[connErr.code] && attempt < 5) {
                  var wait = 1000 * attempt;
                  console.error('  connect ' + variation_db.database + ' failed (' + connErr.code +
                                '); retry ' + attempt + '/4 in ' + wait + 'ms');
                  return setTimeout(tryConnect, wait);
                }
                return reject(connErr);
              }
              conn.query(sql)
                .on('error', function(qErr) {
                  if (settled) return; settled = true;
                  try { conn.destroy(); } catch (e) {}
                  reject(qErr);
                })
                .on('result', function(row) {
                  var id = row.qtl_feature.split('_').pop();
                  if (!toterms.hasOwnProperty(id)) {
                    toterms[id] = [];
                    qtls.push({
                      _id: id,
                      location: {
                        map: mapLUT[system_name],
                        region: row.region,
                        start: row.start,
                        end: row.end
                      },
                      source: row.source,
                      description: row.description,
                      terms: toterms[id]
                    });
                  }
                  toterms[id].push(row.term);
                })
                .on('end', function() {
                  if (settled) return; settled = true;
                  try { conn.end(); } catch (e) {}
                  resolve();
                });
            });
          })();
        });
      }

      // concurrency-limited runner over variation_dbs (resolves even when the list is empty)
      (async function runAll() {
        try {
          var queue = variation_dbs.slice();
          async function worker() {
            while (queue.length) {
              await processDb(queue.shift());
            }
          }
          var n = Math.min(MAX_CONC, variation_dbs.length) || 0;
          var workers = [];
          for (var i = 0; i < n; i++) workers.push(worker());
          await Promise.all(workers);
          deferred.resolve(qtls);
        } catch (e) {
          deferred.reject(e);
        }
      })();
    })
  })
  return deferred.promise;
}

#!/usr/bin/env node
var collections = require('gramene-mongodb-config');
var variation_dbs = require('../ensembl_db_info.json').variations;
var Q = require('q');

// connect to mysql database
var mysql = require('mysql');

var sql= 'select s.name as source, pf.object_id as qtl_feature, p.description, po.accession as term, sr.name as region, pf.seq_region_start start, pf.seq_region_end end'
 + ' from source s, phenotype_feature pf, phenotype p, phenotype_ontology_accession po, seq_region sr'
 + ' where pf.type="QTL" and pf.source_id = s.source_id and pf.phenotype_id = p.phenotype_id and p.phenotype_id = po.phenotype_id and pf.seq_region_id = sr.seq_region_id';

get_qtls().then(function(qtls) {
  console.error('got_qtls',qtls.length);
  collections.qtls.mongoCollection().then(function(mongoQTLs) {
    mongoQTLs.insertMany(qtls, function(err, result) {
      if (err) {
        throw err;
      }
      console.log("finished loading QTLs");
      collections.closeMongoDatabase();
    })
  })
})

function get_qtls() {
  var deferred = Q.defer();
  collections.maps.mongoCollection().then(function(mongoMaps) {
    mongoMaps.find().toArray(function(err, docs) {
      var qtls = [];
      var toterms = {};
      var running=0;
      var connections = [];
      var mapLUT = {};
      console.error("got docs from maps");
      docs.forEach(function(map) {
        mapLUT[map.system_name] = map._id;
      })
      variation_dbs.forEach((variation_db,idx) => {
        const db_words = variation_db.database.split('_variation_');
        const system_name = db_words[0];
        connections.push(mysql.createConnection(variation_db));
        if (!connections[idx]) throw "error";
        connections[idx].connect();
        running++;
        // console.error('query',running,system_name,sql);
        connections[idx].query(sql)
        .on('error', function(err) {
          throw err;
        })
        .on('result', function(row) {
          const id = row.qtl_feature.split('_').pop();
        
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
            })
          }
          toterms[id].push(row.term);
        })
        .on('end', function() {
          running--;
          // console.error(idx,'idx', running,'queries remaining');
          connections[idx].end();
          if (running === 0) {
            deferred.resolve(qtls);
          }
        });  
      })
    })
  })
  return deferred.promise;
}

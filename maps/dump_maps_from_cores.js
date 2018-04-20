#!/usr/bin/env node
// connect to mysql database
var mysql = require('mysql');
var cores = require('../ensembl_db_info.json').cores;
var collections = require('gramene-mongodb-config');
var Q = require('q');
var _ = require('lodash');

var taxon_tally = {};
var taxon_offset = {};
var promises = cores.map(function(core) {
  return get_maps(core);
});

var mongoMapsPromise = collections.maps.mongoCollection();

var mapsPromise = Q.all(promises).then(function(maps) {
  return _.flatten(maps);
});
mapsPromise.then(function(maps) {
  mongoMapsPromise.then(function(mapsCollection) {
    var insertThese = maps.map(function(map) {
      if (taxon_tally[map.taxon_id] > 1) {
        var newTaxId = map.taxon_id * 1000 + taxon_offset[map.taxon_id];
        taxon_offset[map.taxon_id]++;
        map.taxon_id = newTaxId;
      }
      return map;
    });
    mapsCollection.insertMany(insertThese, function(err, result) {
      if (err) {
        throw err;
      }
      console.error("finished loading maps");
      collections.closeMongoDatabase();
    });
  });
});


function get_maps(dbInfo) {
  var deferred = Q.defer();
  var core = mysql.createConnection(dbInfo);
  if (!core) throw "error";
  core.connect();
  core.query('select species_id,meta_key,meta_value from meta', function(err, rows, fields) {
    if (err) throw err;
    // do something with the metadata
    var meta = {};
    rows.forEach(function(r) {
      if (! meta.hasOwnProperty(r.species_id)) {
        meta[r.species_id] = {};
      }
      meta[r.species_id][r.meta_key] = r.meta_value;
    });
    var running = 0;
    var deezmaps = [];
    Object.keys(meta).forEach(function(species_id) {
      running++;
      var map = {
        db: dbInfo.database,
        _id: meta[species_id].hasOwnProperty('assembly.accession') ? meta[species_id]['assembly.accession'] : meta[species_id]['assembly.name'],
        taxon_id: +meta[species_id]['species.taxonomy_id'],
        system_name: meta[species_id]['species.production_name'],
        display_name: meta[species_id]['species.display_name'],
        type: 'genome',
        length: 0,
        regions: {
          names: [],
          lengths: []
        }
      }
      if (!taxon_tally.hasOwnProperty(map.taxon_id)) {
        taxon_tally[map.taxon_id] = 0;
        taxon_offset[map.taxon_id]=0;
      }
      taxon_tally[map.taxon_id]++;
      core.query('SELECT sr.seq_region_id, sr.name, sr.length, sr.coord_system_id, sra.value '
      + 'FROM seq_region sr, seq_region_attrib sra, attrib_type at, coord_system cs '
      + 'WHERE at.code = "karyotype_rank" '
      + 'AND at.attrib_type_id = sra.attrib_type_id '
      + 'AND sra.seq_region_id = sr.seq_region_id '
      + 'AND sr.coord_system_id = cs.coord_system_id '
      + 'AND cs.species_id = ' + species_id, function(err, rows, fields) {
        if (err) throw err;
        rows.forEach(function(r) {
          r.value = +r.value;
        });
        rows.sort(function(a,b) {
          if (a.value > b.value) {
             return 1;
           }
           if (a.value < b.value) {
             return -1;
           }
           // a must be equal to b
           return 0;
        });
        rows.forEach(function(r) {
          map.regions.names.push(r.name);
          map.regions.lengths.push(r.length);
          map.length += r.length;
        });
        core.query('SELECT SUM(sr.length) as sum '
        + 'FROM seq_region sr, seq_region_attrib sra, attrib_type at, coord_system cs '
        + 'WHERE at.code = "toplevel"  '
        + 'AND at.attrib_type_id = sra.attrib_type_id '
        + 'AND sra.seq_region_id = sr.seq_region_id '
        + 'AND sr.coord_system_id = cs.coord_system_id  '
        + 'AND cs.species_id = '+species_id, function(err, rows, fields) {
          if (err) throw err;
          var unanchored = rows[0].sum - map.length;
          if (!!unanchored) {
            map.regions.names.push('UNANCHORED');
            map.regions.lengths.push(unanchored);
          }
          core.query('SELECT COUNT(*) as num_genes '
          + 'FROM gene g, seq_region sr, coord_system cs '
          + 'WHERE g.is_current=1 '
          + 'AND g.seq_region_id = sr.seq_region_id '
          + 'AND sr.coord_system_id = cs.coord_system_id '
          + 'AND cs.species_id = '+species_id, function(err, rows, fields) {
            if (err) throw err;
            map.num_genes = rows[0].num_genes;
            if (map.num_genes && map.taxon_id) {
              deezmaps.push(map);
            }
            running--;
          });
        });
      });
    });
    function poll() {
      if (running) {
        setTimeout(poll, 5000)
      }
      else {
        core.end();
        deferred.resolve(deezmaps);
      }
    }
    poll();
  });
  return deferred.promise;
}
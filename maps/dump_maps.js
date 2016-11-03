#!/usr/bin/env node
var argv = require('minimist')(process.argv.slice(2));

var grm = argv.g;
var ens = argv.e;

// connect to mysql database
var mysql = require('mysql');
var connection = mysql.createConnection({
  host: argv.h,
  user: argv.u,
  password: argv.p,
  database: 'information_schema'
});

if (!connection) throw "error";
connection.connect();

if (argv.d) {
  dump_map(argv.d);
}
else {
  var sql = 'select SCHEMA_NAME from SCHEMATA where SCHEMA_NAME like "%_core_'
    + grm + '_' + ens + '_%"';
  connection.query(sql, function(err, rows, fields) {
    if (err) throw err;
    rows.forEach(function(row) {
      dump_map(row.SCHEMA_NAME);
    });
    connection.end();
  });
}

function dump_map(dbName) {
  var core = mysql.createConnection({
    host: argv.h,
    user: argv.u,
    password: argv.p,
    database: dbName
  });
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
    Object.keys(meta).forEach(function(species_id) {
      running++;
      var map = {
        db: dbName,
        _id: meta[species_id].hasOwnProperty('assembly.accession') ? meta[species_id]['assembly.accession'] : meta[species_id]['assembly.default'],
        taxon_id: +meta[species_id]['species.taxonomy_id'],
        system_name: meta[species_id]['species.production_name'],
        type: 'genome',
        length: 0,
        regions: {
          names: [],
          lengths: []
        }
      }
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
              console.log(JSON.stringify(map));
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
      }
    }
    poll();
  });
}
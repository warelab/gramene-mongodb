#!/usr/bin/env node
var argv = require('minimist')(process.argv.slice(2));

var grm = argv.g;
var ens = argv.e;
// connect to mysql database
var mysql = require('mysql');
var connection = mysql.createConnection({
  host: argv.h,
  user: argv.u,
  password: argv.p || '',
  database: 'information_schema'
});

if (!connection) throw "error";
connection.connect();

if (argv.d) {
  dump_map(argv.d);
}
else {
  var sql = 'select SCHEMA_NAME from SCHEMATA where SCHEMA_NAME like "%_core_';
  var sql2 = ' or SCHEMA_NAME like "%_variation_';
  var compara = 'ensembl_compara'
  if (grm) {
    sql += `${grm}_`;
    sql2 += `${grm}_`;
    compara += `_plants_${grm}`;
  }
  if (ens) {
    sql += `${ens}_`;
    sql2 += `${ens}_`;
    compara += `_${ens}`;
  }
  sql += '%"';
  sql2 += '%"';
  sql += sql2;
  connection.query(sql, function(err, rows, fields) {
    if (err) throw err;
    var cores = [];
    var variations = [];
    rows.forEach(function(row) {
      if (row.SCHEMA_NAME.includes('_core_')) {
        cores.push({
          host: argv.h,
          port: 3306,
          user: argv.u,
          password: argv.p || '',
          database: row.SCHEMA_NAME
        });
      }
      if (row.SCHEMA_NAME.includes('_variation_')) {
        variations.push({
          host: argv.h,
          port: 3306,
          user: argv.u,
          password: argv.p || '',
          database: row.SCHEMA_NAME
        });
      }
    });
    console.log(JSON.stringify({
      compara: {
        host: argv.h,
        user: argv.u,
        password: argv.p || '',
        database: compara
      },
      cores: cores,
      variations: variations
    }, null, ' '));
    connection.end();
  });
}

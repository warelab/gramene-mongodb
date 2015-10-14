#!/usr/bin/env node
var genes = require('../config/collections.js').genes;
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

var sql = 'select SCHEMA_NAME from SCHEMATA where SCHEMA_NAME like "%_core_'
  + grm + '_' + ens + '_%" or SCHEMA_NAME like "%_otherfeatures_' + grm + '_' + ens + '%"';
connection.query(sql, function(err, rows, fields) {
  if (err) throw err;
  rows.forEach(function(row) {
    var cmd = './dump_genes.js -h '+argv.h+' -u '+argv.u+' -p '+argv.p+' -d '+row.SCHEMA_NAME
    + ' | gzip -c > tmp/'+row.SCHEMA_NAME+'.json.gz';
    console.log(cmd);
  });
  connection.end();
});

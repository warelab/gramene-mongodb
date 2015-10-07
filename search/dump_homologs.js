#!/usr/bin/env node
var argv = require('minimist')(process.argv.slice(2));

// connect to mysql database
var mysql = require('mysql');
var connection = mysql.createConnection({
  host: argv.h,
  user: argv.u,
  password: argv.p,
  database: argv.d
});
if (!connection) throw "error";
connection.connect();
var sql = 'select'
  + ' g1.stable_id as geneId,'
  + ' g2.stable_id as otherId,'
  + ' h.description as kind,'
  + ' h.is_tree_compliant as isTreeCompliant'
  + ' from homology h'
  + ' inner join homology_member hm on hm.homology_id = h.homology_id'
  + ' inner join gene_member g1 on hm.gene_member_id = g1.gene_member_id'
  + ' inner join homology_member hm2 on hm2.homology_id = h.homology_id and hm.gene_member_id > hm2.gene_member_id'
  + ' inner join gene_member g2 on hm2.gene_member_id = g2.gene_member_id'
  + ' ;';

function redisify() {
  var red = [];
  red.push('*'+arguments.length);
  Array.prototype.slice.call(arguments).forEach(function(a) {
    red.push('$'+a.length,a);
  });
  return red.join("\r\n") + "\r";
}

connection.query(sql)
  .on('error', function(err) {
    // Handle error, an 'end' event will be emitted after this as well
    throw err;
  })
  .on('fields', function(fields) {
    // the field packets for the rows to follow
    console.log(redisify('SELECT','1'));
    console.log(redisify('FLUSHDB'));
  })
  .on('result', function(row) {
    // Pausing the connnection is useful if your processing involves I/O
    connection.pause();
    console.log(redisify('HSET',row.geneId, row.otherId, row.kind));
    console.log(redisify('HSET',row.otherId, row.geneId, row.kind));
    connection.resume();
  })
  .on('end', function() {
    // all rows have been received
  });
connection.end();
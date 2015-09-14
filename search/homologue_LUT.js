var mysql = require('mysql');
var fs = require('fs');
var _ = require('lodash');
var through2 = require('through2');
var neo4j = require('neo4j');

// creating db connections is synchronous
var comparaMysqlDb = mysql.createConnection({
  "host": "cabot",
  "user": "gramene_web",
  "password": "gram3n3",
  "database": "ensembl_compara_plants_46_80"
});

var neoDb = new neo4j.GraphDatabase('http://neo4j:its5aT3I@localhost:7474');

var allOrthologuesQuery = fs.readFileSync('./all_orthologues.sql', {encoding: 'utf8'});

var destinationFile = fs.createWriteStream('orthologs.ldjson');

var count = 0;
var tidyRow = through2.obj(function (row, enc, done) {
  if (++count % 1000 === 0) {
    console.log(count);
  }
  this.push(row);
  done();
});

//var toNeo = through2.obj(function (row, enc, done) {
//  var query = "merge (a:Gene{name:'" + row.gene_a + "'}) merge (b:Gene{name:'" + row.gene_b + "'}) merge (a)-[h:HOMOLOGY{kind:'" + row.description + "'}]->(b) return a, b, h"
//
//  var callMeWhenDone = function(err, stuff) {
//    this.push(row);
//    done();
//  }.bind(this);
//
//  neoDb.cypher({
//    query: query
//  }, callMeWhenDone);
//});

var toJSON = through2.obj(function (row, enc, done) {
  this.push(JSON.stringify(row) + '\n');
  done();
});

comparaMysqlDb.query(allOrthologuesQuery)
  .stream({highWaterMark: 5})
  .pipe(tidyRow)
  //.pipe(toNeo)
  .pipe(toJSON)
  .pipe(destinationFile);

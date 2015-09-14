var mongoURL = 'mongodb://brie:27017/search46';

var MongoClient = require('mongodb').MongoClient;
var mysql = require('mysql');
var fs = require('fs');
var _ = require('lodash');
var Q = require('q');
var FS = require('q-io/fs');
var through2 = require('through2');
var byline = require('byline');
var TreeModel = require('tree-model');

var filename = process.argv[2];

// creating mysql connection is synchronous
var comparaMysqlDb = mysql.createPool({
  "connectionLimit": 100,
  "host": "cabot",
  "user": "gramene_web",
  "password": "gram3n3",
  "database": "ensembl_compara_plants_46_80"
});

// do all the one-time async stuff
Q.all([
  // get the SQL template for finding orthologs
  FS.read('./orthologues.template.sql', {encoding: 'utf8'}),

  // open a connection to mongo
  Q.nfcall(MongoClient.connect, mongoURL)
])
  .spread(function addTreesToAllGenes(orthologuesSqlTemplate, db) {
    var genetreeMongoCollection = db.collection('genetree');

    var toJson = through2.obj(function (line, enc, done) {
      this.push(JSON.parse(line.toString()));
      done();
    });

    // Make-your-own-promise to account for connection cleanup in callback.
    function queryPromiseUsingPool(gene) {
      var deferred = Q.defer();
      comparaMysqlDb.getConnection(function(err, connection) {
        connection.query(orthologuesSqlTemplate, [gene._id], function(err, rows) {
          connection.release();
          if(err) {
            deferred.reject(err);
          }
          deferred.resolve(rows);
        });
      });
      return deferred.promise;
    }

    var time = new Date().getTime();
    var count = 0;

    var addTree = through2.obj(function (gene, enc, done) {
      var newTime = new Date().getTime();
      if (++count && (newTime - time) > 5000) {
        console.log(count);
        time = newTime;
      }
      var streamCtx = this;
      if (gene.grm_gene_tree) {
        //console.log("will request genetree " + gene.grm_gene_tree + " for " + gene._id);
        Q.all([
          Q.ninvoke(genetreeMongoCollection, 'findOne', {tree_id: gene.grm_gene_tree}),
          queryPromiseUsingPool(gene)
        ]).spread(function (rawTree, orthos) {
          //console.log("got " + rawTree._id + " for " + gene._id + " and " + _.size(orthos) + " ortho/paras");
          var tree = new TreeModel().parse(rawTree);
          streamCtx.push(gene);
          done();
        }).catch(function(err) {
          console.error(err);
        });
      }
      else {
        this.push(gene);
        done();
      }
    });

    var fromJson = through2.obj(function (gene, enc, done) {
      this.push(JSON.stringify(gene) + '\n');
      done();
    });

    fs.createReadStream(filename, {encoding: 'utf8'})
      .pipe(byline.createStream())
      .pipe(toJson)
      .pipe(addTree)
      .pipe(fromJson)
      .pipe(fs.createWriteStream(filename.replace(/json$/, 'out.json'), {encoding: 'utf8'}));

  });
//require('readline').createInterface({
//  input: ,
//  terminal: false
//}).on('line', function (line) {
//  var gene = JSON.parse(line);
//
//}).on('close', function() {
//  console.log(lineCount);
//});
var mongoURL = 'mongodb://brie:27017/search46';

var MongoClient = require('mongodb').MongoClient;
var neo4j = require('neo4j');
var fs = require('fs');
var _ = require('lodash');
var Q = require('q');
var through2 = require('through2');
var byline = require('byline');
var TreeModel = require('tree-model');


var homologGraph = new neo4j.GraphDatabase('http://neo4j:its5aT3I@localhost:7474');

var getHomologs = function(geneId) {
  var defer = Q.defer();
  homologGraph.cypher({
    query: 'MATCH (g:Gene {name: {gene}})-[h:HOMOLOGY]-(g2:Gene) RETURN h.kind as kind, g2.name as id',
    params: { gene: geneId }
  }, function (err, results) {
    if (err) {
      defer.reject(err);
    }
    else {
      defer.resolve(results);
    }
  });
  return defer.promise;
};

var filename = process.argv[2];

// do all the one-time async stuff
MongoClient.connect(mongoURL, function (err, db) {
  var findTree = Q.nbind(db.collection('genetree').findOne, db.collection('genetree'));

  var toJson = through2.obj(function (line, enc, done) {
    this.push(JSON.parse(line.toString()));
    done();
  });

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
      Q.all([
        findTree({tree_id: gene.grm_gene_tree}),
        getHomologs(gene._id)
      ]).spread(function (rawTree, homologs) {
        var tree = new TreeModel().parse(rawTree);
        streamCtx.push(gene);
        done();
      }).catch(function (err) {
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
////require('readline').createInterface({
////  input: ,
////  terminal: false
////}).on('line', function (line) {
////  var gene = JSON.parse(line);
////
////}).on('close', function() {
////  console.log(lineCount);
//});
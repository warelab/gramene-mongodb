var mongoURL = 'mongodb://brie:27017/search46';

var MongoClient = require('mongodb').MongoClient;
var fs = require('fs');
var _ = require('lodash');
var through2 = require('through2');
var byline = require('byline');
var TreeModel = require('tree-model');

var orthologueSqlTemplate = fs.readFileSync('./orthologues.template.sql', {encoding: 'utf8'});

var filename = process.argv[2];


MongoClient.connect(mongoURL, function (err, db) {

  var toJson = through2.obj(function (line, enc, done) {
    this.push(JSON.parse(line.toString()));
    done();
  });

  var addTree = through2.obj(function (gene, enc, done) {
    var streamCtx = this;
    if (gene.grm_gene_tree) {
      if (err) throw err;
      db.collection('genetree').findOne({tree_id: gene.grm_gene_tree}, function (err, res) {
        var tree = new TreeModel().parse(res);
        streamCtx.push(gene);
        done();
      });
    }

    this.push(gene);
    done();
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
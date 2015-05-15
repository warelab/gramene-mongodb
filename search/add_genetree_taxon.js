var mongoURL = 'mongodb://127.0.0.1:27017/search45';

var MongoClient = require('mongodb').MongoClient;
var fs = require('fs');
var _ = require('lodash');

var filename = process.argv[2];

function modifyGeneDocs(genetreeLUT) {
  require('readline').createInterface({
    input: fs.createReadStream(filename),
    terminal: false
  }).on('line', function (line) { // one JSON object per line
    var obj = JSON.parse(line);
    if(obj.epl_gene_tree) {
      obj.epl_gene_tree_root_taxon_id = genetreeLUT[obj.epl_gene_tree].node_taxon_id;
    }
    console.log(JSON.stringify(obj));
  });
}

// connect to the ontologies database
MongoClient.connect(mongoURL, function(err, db) {
  if (err) throw err;
  db.collection('genetree').find({}, {node_taxon_id: 1}).toArray(function(err, docs) {
    if (err) throw err;
    modifyGeneDocs(_.indexBy(docs, '_id'));
  });
});

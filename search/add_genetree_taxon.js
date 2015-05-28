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
      var tree = genetreeLUT[obj.epl_gene_tree];
      obj.grm_gene_tree = tree.tree_id;
      obj.grm_gene_tree_root_taxon_id = tree.node_taxon_id;
      if(tree.stableIds.length > 1) {
        obj.epl_sibling_trees = _.filter(tree.stableIds, function(id) { return id !== obj.epl_gene_tree; });
      }
    }
    console.log(JSON.stringify(obj));
  });
}

// connect to the ontologies database
MongoClient.connect(mongoURL, function(err, db) {
  if (err) throw err;
  db.collection('genetree').find({}, {node_taxon_id: 1, stableIds: 1, tree_id: 1}).toArray(function(err, docs) {
    if (err) throw err;
    var lut = _.reduce(docs, function(acc, doc) {
      _.forEach(doc.stableIds, function(stableId) {
        acc[stableId] = doc;
      });
      return acc;
    }, {});

    modifyGeneDocs(lut);
    db.close();
  });
});

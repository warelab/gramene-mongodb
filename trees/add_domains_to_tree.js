var TreeModel = require('tree-model');
var treeModel = new TreeModel();
var _ = require('lodash');
var through2 = require('through2');
var argv = require('minimist')(process.argv.slice(2));

var collections = require('gramene-mongodb-config');

var decorateTree = function(geneCollection) { 
  return through2.obj(function decorateTree(mongoTree, encoding, done) {
    var throughThis = this;
    geneCollection.find(
      {'homology.gene_tree.id': mongoTree._id},
      {'gene_structure':1})
    .toArray(function (err, geneDocs) {
      if (err) throw err;
      var domain_lut = {};
      geneDocs.forEach(function(gene) {
        if (gene.gene_structure.hasOwnProperty('canonical_transcript')) {
          var translation = gene.gene_structure.transcripts[gene.gene_structure.canonical_transcript].translation;
          if (translation.features.domain && translation.features.domain.architecture) {
            domain_lut[gene._id] = translation.features.domain.architecture.map(function(domain) {
              return {
                interpro: domain.interpro,
                start: domain.start,
                end: domain.end,
                name: domain.name,
                id: +domain.root
              }
            });
          }
        }
      });
  
      var tree = treeModel.parse(mongoTree);
      tree.walk(function (node) {
        if (!node.children.length) {
          var id = node.model.gene_stable_id;
          if (domain_lut.hasOwnProperty(id)) {
            node.model.domains = domain_lut[id];
          }
        }
      });
      throughThis.push(mongoTree);
      done();
    });
  });
}

var upsertTreeIntoMongo = function upsertTreeIntoMongo(mongoCollection) {
  var transform = function (tree, enc, done) {
    var throughThis = this;
    mongoCollection.update(
      {_id: tree._id},
      tree,
      {upsert: true},
      function (err, count, status) {
        //throughThis.push({err: err, status: status, _id: tree._id});
        done();
      }
    );
  };

  var flush = function(done) {
    collections.closeMongoDatabase();
    console.log('upsert to mongo is done');
    done();
  };

  return through2.obj(transform, flush);
};

collections.genetrees.mongoCollection().then(function(treeCollection) {
  collections.genes.mongoCollection().then(function(geneCollection) {
    var upsert = upsertTreeIntoMongo(treeCollection);

    var treeStream = treeCollection.find({compara_db:argv.d}).stream();

    treeStream
      .pipe(decorateTree(geneCollection))
      .pipe(upsert);
  });
});
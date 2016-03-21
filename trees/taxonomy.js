var TreeModel = require('tree-model');
function childNodeComparator(a, b) {
  return a.left_index < b.left_index ? 1 : -1;
}

var treeModel = new TreeModel({modelComparatorFn:childNodeComparator});
var _ = require('lodash');
var through2 = require('through2');
var fs = require('fs');
var collections = require('gramene-mongodb-config');
var argv = require('minimist')(process.argv.slice(2));

var flatten = through2.obj(function (tree, enc, done) {
  tree.treeModel = treeModel.parse(tree);
  tree.treeModel.all(function (node) {
    node.model.ancestors = [node.model.taxon_id];
    if (node.parent) {
      node.model.is_a = [node.parent.model.taxon_id];
      var np = node;
      while (np.parent) {
        np = np.parent;
        node.model.ancestors.push(np.model.taxon_id);
      }
    }
    this.push(node.model);
  }.bind(this));
  done();
});

var cleanup = through2.obj(function(node,enc,done) {
  var ncbi = {
    _id: node.taxon_id,
    id: 'NCBITaxon:'+node.taxon_id,
    namespace: 'ncbi_taxonomy',
    name: node.taxon_name,
    num_genes: node.num_genes,
    property_value: 'has_rank NCBITaxon:'+node.rank,
    synonym: node.synonyms,
    ancestors: node.ancestors
  };
  if (node.is_a) {
    ncbi.is_a = node.is_a;
  }
  this.push(ncbi)
  done();
});

var upsertTaxNodeIntoMongo = function upsertTaxNodeIntoMongo(mongoCollection) {
  var transform = function (node, enc, done) {
    var throughThis = this;
    mongoCollection.update(
      {_id: node._id},
      node,
      {upsert: true},
      function (err, count, status) {
        throughThis.push({err: err, status: status, _id: node.taxon_id});
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

var serialize = through2.obj(function (r, enc, done) {
  if (r.err) {
    this.push(JSON.stringify(r) + "\n");
  }
  done();
}, function (done) {
  console.log('serializer is done');
  done();
});

var fileWriter = fs.createWriteStream('./inserts.jsonl');

collections.speciestrees.mongoCollection({_id:argv.t}).then(function(treeCollection) {
  collections.taxonomy.mongoCollection().then(function(taxCollection) {
    var upsert = upsertTaxNodeIntoMongo(taxCollection);
    treeCollection.find().pipe(flatten)
    .pipe(cleanup)
    .pipe(upsert)
    .pipe(serialize)
    .pipe(fileWriter);

    fileWriter.on('finish', function () {

      console.log('We are done here.');

      // it would be super if this were not necessary.
      // process.exit(0);
    });
  });
})

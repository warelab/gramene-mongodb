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
      {'gene_structure':1,'taxon_id':1})
    .toArray(function (err, geneDocs) {
      if (err) throw err;
      var domain_lut = {};
      var taxon_lut = {};
      var exonJunctions_lut = {};
      var nTranscripts_lut = {};
      geneDocs.forEach(function(gene) {
        taxon_lut[gene._id] = gene.taxon_id;
        if (gene.gene_structure.hasOwnProperty('canonical_transcript')) {
          nTranscripts_lut[gene._id] = gene.gene_structure.transcripts.length;
          var tIdx = _.keyBy(gene.gene_structure.transcripts,'id');
          var ct = tIdx[gene.gene_structure.canonical_transcript];
          if (ct.translation && ct.translation.features.domain && ct.translation.features.domain.architecture) {
            domain_lut[gene._id] = ct.translation.features.domain.architecture.map(function(domain) {
              return {
                id: domain.interpro,
                root: +domain.root,
                start: domain.start,
                end: domain.end,
                name: domain.name,
                description: domain.description
              }
            });
          }
          if (!!ct.exon_junctions) {
            exonJunctions_lut[gene._id] = ct.exon_junctions.filter(function(jpos) {
              return (jpos >= ct.cds.start && jpos <= ct.cds.end)
            })
            .map(function(jpos) {
              return Math.floor((jpos - ct.cds.start) / 3) + 1;
            });
          }
        }
      });
  
      var tree = treeModel.parse(mongoTree);
      tree.walk(function (node) {
        if (!node.children.length) {
          var id = node.model.gene_stable_id;
          if (taxon_lut.hasOwnProperty(id)) {
            node.model.taxon_id = taxon_lut[id];
          }
          if (domain_lut.hasOwnProperty(id)) {
            node.model.domains = domain_lut[id];
          }
          if (nTranscripts_lut.hasOwnProperty(id)) {
            node.model.nTranscripts = nTranscripts_lut[id];
          }
          if (exonJunctions_lut.hasOwnProperty(id) && exonJunctions_lut[id].length > 0) {
            node.model.exon_junctions = exonJunctions_lut[id];
          }
        }
      });
      throughThis.push(mongoTree);
      done();
    });
  });
}

var upsertTreeIntoMongo = function upsertTreeIntoMongo(mongoCollection) {
  var nTrees = 0;
  var transform = function (tree, enc, done) {
    var throughThis = this;
    mongoCollection.update(
      {_id: tree._id},
      tree,
      {upsert: true},
      function (err, count, status) {
        //throughThis.push({err: err, status: status, _id: tree._id});
        nTrees++;
        if (nTrees % 1000 === 0) {
          console.error(`updated ${nTrees} trees`);
        }
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
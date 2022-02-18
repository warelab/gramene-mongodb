var TreeModel = require('tree-model');
var treeModel = new TreeModel();
var _ = require('lodash');
var through2 = require('through2');
var comparaDatabase = require('../ensembl_db_info.json').compara.database;
var collections = require('gramene-mongodb-config');

var decorateTree = function(geneCollection, iprInfo) { 
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
          else {
            if (ct.translation && ct.translation.features) {
              var features = {};
              var fTypes = Object.keys(ct.translation.features);
              if (ct.translation.features.family && fTypes.length > 1) {
                delete ct.translation.features.family;
                console.log('deleted family features. these remain',ct.translation.features);
              }
              Object.keys(ct.translation.features).forEach(function(featureType) {
                ct.translation.features[featureType].entries.forEach(function(feature) {
                  if (feature.interpro) {
                    if (!features[feature.interpro]) {
                      features[feature.interpro] = []
                    }
                    features[feature.interpro].push({
                      id: feature.interpro,
                      root: 0,
                      start: feature.start,
                      end: feature.end,
                      name: iprInfo[feature.interpro].name,
                      description: iprInfo[feature.interpro].description
                    })
                  }
                });
              })
              // uniqify overlapping features from same id
              var uniqified = [];
              Object.keys(features).forEach(function(featureType) {
                features[featureType].sort(function(a,b) {
                  return a.start - b.start;
                });
                var merged = [];
                merged.push(features[featureType].shift());
                features[featureType].forEach(function(feature) {
                  if (feature.start > merged[merged.length - 1].end) {
                    merged.push(feature);
                  }
                  else {
                    if (feature.end > merged[merged.length - 1].end) {
                      merged[merged.length - 1].end = feature.end;
                    }
                  }
                });
                merged.forEach(function(feature) {
                  uniqified.push(feature);
                });
                domain_lut[gene._id] = uniqified;
              });
            }
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
    mongoCollection.updateOne(
      {_id: tree._id},
      { $set: tree},
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
    collections.domains.mongoCollection().then(function(domainsCollection) {
      domainsCollection.find().toArray(function(err, domainDocs) {
        if (err) throw err;
        var iprInfo = {};
        domainDocs.forEach(function(domain) {
          iprInfo[domain.id] = domain;
        });
        var upsert = upsertTreeIntoMongo(treeCollection);

        var treeStream = treeCollection.find({compara_db:comparaDatabase}).stream();

        treeStream
          .pipe(decorateTree(geneCollection,iprInfo))
          .pipe(upsert);
      })
    })
  });
});
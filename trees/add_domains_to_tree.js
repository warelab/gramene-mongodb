var TreeModel = require('tree-model');
var treeModel = new TreeModel();
var _ = require('lodash');

var collections = require('gramene-mongodb-config');

var done = false;
collections.genetrees.mongoCollection().then(function(treeCollection) {
  collections.genes.mongoCollection().then(function(geneCollection) {
    var treeCursor = treeCollection.find();
    treeCursor.each(function(err,mongoTree) {
      if (err) throw err;
      if (mongoTree === null) {
        // too soon?
        // treeCollection.closeMongoDatabase();
        console.error("mongoTree is null");
        done=true;
      }
      else {
        geneCollection.find(
          {grm_gene_tree: mongoTree._id},
          {'canonical_translation.features.domain_architecture':1})
        .toArray(function (err, gene_domains) {
          var domain_lut = {};
          gene_domains.forEach(function(gd) {
            if (gd.hasOwnProperty('canonical_translation')) {
              domain_lut[gd._id] = gd.canonical_translation.features.domain_architecture.map(function(domain) {
                return {
                  interpro: domain.interpro,
                  start: domain.start,
                  end: domain.end,
                  name: domain.name,
                  id: +domain.root
                }
              });
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
          treeCollection.update(
            {_id: mongoTree._id},
            mongoTree,
            {upsert: true},
            function (err, count, status) {
              if (err) throw err;
              if (done) {
                console.error("closing db");
                treeCollection.closeMongoDatabase();
              }
            }
          );
        });
      }
    });
  });
});

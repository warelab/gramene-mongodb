#!/usr/bin/env node
var _ = require('lodash');
var Q = require('q');
var collections = require('gramene-mongodb-config');

function parseAssays() {
  var deferred = Q.defer();
  var assays = {};
  require('readline').createInterface({
    input: process.stdin,
    terminal: false
  })
  .on('line', function(line) {
    var fields = line.split("\t");
    var _id = fields[0] + '_' + fields[1];
    if (!assays.hasOwnProperty(_id)) {
      assays[_id] = {
        'experiment' : fields[0],
        'group'      : fields[1],
        'characteristics' : {},
        'factors' : {}
      }
    }
    var c = fields[3].replace(/\s/g,'_');
    assays[_id][fields[2]+'s'][c] = fields[4];
    if (c === 'organism') {
      assays[_id].taxon_id = +fields[5].replace(/.*NCBITaxon_/,'');
    }
  })
  .on('close', function() {
    var experiments = _.groupBy(assays,'experiment');
    deferred.resolve(experiments);
  });
  return deferred.promise;
}

collections.taxonomy.mongoCollection().then(function(taxonomyCollection) {
  taxonomyCollection.find({subset:'gramene'},{_id:1,name:1}).toArray(function (err, docs) {
    var taxonomy = {};
    docs.forEach(function(doc) {
      taxonomy[doc._id] = doc.name;
    })
    var lut={};
    parseAssays().then(function(experiments) {
      _.forEach(experiments, function(experiment, id) {
        if (taxonomy.hasOwnProperty(experiment[0].taxon_id)) {
          var url = `ftp://ftp.ebi.ac.uk/pub/databases/microarray/data/atlas/experiments/${id}/${id}.tsv`;
          console.log('ftp '+url);
          experiment.forEach(function(e) {
            e._id = e.experiment + "." + e.group;
          });
          collections.expression.mongoCollection().then(function(atlasCollection) {
            atlasCollection.insert(experiment, function(err, records) {
              collections.closeMongoDatabase();
            });
          });
        }
      });
    });
  });
});

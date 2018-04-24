#!/usr/bin/env node
var _ = require('lodash');
var Q = require('q');
var FTPS = require('ftps');
var fs = require('fs');
var xml2js = require('xml2js').parseString;
var collections = require('gramene-mongodb-config');
var ftps = new FTPS({
  host: 'ftp.ebi.ac.uk'
});

function parseAssays() {
  var deferred = Q.defer();
  var assays = {};
  require('readline').createInterface({
    input: require('fs').createReadStream(process.argv[3]),
    terminal: false
  })
  .on('line', function(line) {
    var fields = line.split("\t");
    var _id = fields[0] + '_' + fields[1];
    if (!assays.hasOwnProperty(_id)) {
      assays[_id] = {
        'experiment' : fields[0],
        'group'      : fields[1],
        'characteristic' : [],
        'factor' : []
      }
    }
    var c = fields[3].replace(/\s/g,'_');
    
    var info = { type: fields[3], label: fields[4] };
    if (fields.length === 6) {
      var matches = fields[5].match(/.*\/([A-Za-z]+)_(\d+)/);
      if (matches) {
        info.ontology = matches[1];
        info.id = matches[1] + ':' + matches[2];
        info.int_id = +matches[2];
      }
    }
    assays[_id][fields[2]].push(info);
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
    });
    var lut = {};
    parseAssays().then(function(experiments) {
      var experiment_metadata = {};
      var mongoAssays = [];
      _.forEach(experiments, function(experiment, id) {
        if (taxonomy.hasOwnProperty(experiment[0].taxon_id)) {
          if (!experiment_metadata.hasOwnProperty(id)) {
            experiment_metadata[id] = {
              taxon_id : experiment[0].taxon_id
            };
          }
          var url = `/pub/databases/microarray/data/atlas/experiments/${id}/${id}.tsv`;
          console.log(`curl -O ftp.ebi.ac.uk${url}`);
          experiment.forEach(function(e) {
            e._id = e.experiment + "." + e.group;
          });
          Array.prototype.push.apply(mongoAssays,experiment);
        }
      });
      // get the ebeye_baseline_experiments_export.xml
      // and add description to metadata
      fs.readFile(process.argv[2], function(err, xml) {
        if (err) throw err;
        xml2js(xml, function (err, result) {
          if (err) throw err;
          var mongoExperiments = [];
          result.database.entries[0].entry.forEach(function(entry) {
            if (experiment_metadata[entry.$.id]) {
              var e = experiment_metadata[entry.$.id];
              e.description = entry.description[0];
              e._id = entry.$.id;
              mongoExperiments.push(e);
            }
          });
          // insert the assays and experiments to mongodb
          collections.assays.mongoCollection().then(function(assayCol) {
            assayCol.insertMany(mongoAssays, function(err, result) {
              if (err) throw err;
              collections.experiments.mongoCollection().then(function(expCol) {
                expCol.insertMany(mongoExperiments, function(err, result) {
                  if (err) throw err;
                  collections.closeMongoDatabase();
                })
              })
            })
          })
        });
      });
    });
  });
});

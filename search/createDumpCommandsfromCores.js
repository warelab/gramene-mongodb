#!/usr/bin/env node
var collections = require('gramene-mongodb-config');
var cores = require('../ensembl_db_info.json').cores;
var _ = require('lodash');
var coreLUT = _.keyBy(cores,'database');
collections.maps.mongoCollection().then(function(mapsCollection) {
  mapsCollection.find({type:'genome'}).toArray(function (err, genomes) {
    if (err) throw(err);
    collections.closeMongoDatabase();
    genomes.forEach(function(genome) {
      console.log(`echo "${genome.system_name}"`);
      var db = coreLUT[genome.db];
      var password = db.password ? `-p ${db.password}` : '';
      var cmd = `node --max-old-space-size=4096 ./dump_genes.js -h ${db.host} -u ${db.user} ${password} -d ${genome.db} -m '${genome._id}' -t ${genome.taxon_id} | gzip -c > tmp/${genome.system_name}.json.gz`;
      console.log(cmd);
    });
  });
});
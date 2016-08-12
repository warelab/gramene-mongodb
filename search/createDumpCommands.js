#!/usr/bin/env node
var collections = require('gramene-mongodb-config');

var argv = require('minimist')(process.argv.slice(2));
collections.maps.mongoCollection().then(function(mapsCollection) {
  mapsCollection.find({type:'genome'}).toArray(function (err, genomes) {
    if (err) throw(err);
    collections.closeMongoDatabase();
    genomes.forEach(function(genome) {
      var cmd = `./dump_genes.js -h ${argv.h} -u ${argv.u} -p ${argv.p} -d ${genome.db} -m ${genome._id} | gzip -c > tmp/${genome.system_name}.json.gz`;
      console.log(cmd);
    });
  });
});
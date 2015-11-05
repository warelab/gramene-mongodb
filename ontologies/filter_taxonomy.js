#!/usr/bin/env node
// get the species we care about from the maps collection
// read the taxonomy nodes docs into memory and prune the ones that we don't want
var collections = require('gramene-mongodb-config');

collections.maps.mongoCollection().then(function (coll) {
  coll.find({type: 'genome'}, {}).toArray(function (err, genomes) {
    if (err) throw err;
    collections.closeMongoDatabase();
    var species = {};
    genomes.forEach(function(g) {
      species[g.taxon_id] = 1;
    });
    // _id of desired taxonomy nodes
    var desired = {};
    // read the taxonomy docs into memory
    var all = {}; // indexed by _id
    require('readline').createInterface({
      input: require('fs').createReadStream(process.argv[2]),
      terminal: false
    })
    .on('line', function (line) { // one JSON object per line
      var tax_node = JSON.parse(line);
      if (species.hasOwnProperty(tax_node._id)) {
        tax_node.ancestors.forEach(function(id) {
          if (desired.hasOwnProperty(id)) {
            return;
          }
          desired[id] = 1;
        });
      }
      all[tax_node._id] = tax_node;
    })
    .on('close', function() {
      for (var id in desired) {
        console.log(JSON.stringify(all[id]));
      }
    });
  });
});
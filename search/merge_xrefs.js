#!/usr/bin/env node
var _ = require('lodash');
var argv = require('minimist')(process.argv.slice(2));
var collections = require(argv.c);

collections.genes.mongoCollection().then(function (coll) {
  // read the genes docs to update
  require('readline').createInterface(
    {
      input: process.stdin,
      terminal: false
    }
  ).on('line', function(line) { // one JSON object per line
    var obj = JSON.parse(line);
    // try to find this gene in the other mongodb collection
    coll.findOne({_id:obj._id}, {_id: 0, xrefs: 1}).then(function (src) {
      if (src) {
        var res = [];
        var by_db = _.keyBy(obj.xrefs, 'db');
        src.xrefs.forEach(function(xr) {
          if (xr.db !== "PUBMED" && by_db[xr.db]) {
            res.push({
              db: xr.db,
              ids: _.union(by_db[xr.db],xr.ids)
            });              
          }
          else {
            res.push(xr)
          }
        });
        obj.xrefs = res;
      }
      console.log(JSON.stringify(obj))
    });
  }).on('close', function() {
    console.error("I think I'm done.");
  });
})

#!/usr/bin/env node
var _ = require('lodash');
var request = require('sync-request');
var collections = require('gramene-mongodb-config');

function getReactomePrefix(tax_id) {
  // var url = `http://plantreactomedev.oicr.on.ca/ContentService/data/pathways/top/${tax_id}`;
  var url = `http://plantreactomedev.oicr.on.ca/ContentService/data/eventsHierarchy/${tax_id}`;
  console.error("GET ",url);
  var res = request('GET',url);
  if (res.statusCode == 200) {
    var top = JSON.parse(res.getBody());
    return top[0].stId.replace(/R-([A-Z]*)-\d+/,'$1');
  }
}

collections.maps.mongoCollection().then(function(mapsCollection) {
  mapsCollection.find({},{taxon_id:1}).toArray(function (err, docs) {
    collections.closeMongoDatabase();
    var taxonomy = {};
    docs.forEach(function(doc) {
      var prefix = getReactomePrefix(doc.taxon_id);
      if (prefix) {
        taxonomy[doc.taxon_id] = {
          reactomePrefix: prefix
        };
      }
    });
    console.log(JSON.stringify(taxonomy));
  });
});

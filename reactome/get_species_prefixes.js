#!/usr/bin/env node
var _ = require('lodash');
var request = require('sync-request');
var collections = require('gramene-mongodb-config');

function getReactomePrefix(tax_id) {
  // var url = `http://plantreactomedev.oicr.on.ca/ContentService/data/pathways/top/${tax_id}`;
  var url = `https://plantreactome.gramene.org/ContentService/data/eventsHierarchy/${tax_id}`;
  console.error("GET ",url);
  var res = request('GET',url);
  if (res.statusCode == 200) {
    var top = JSON.parse(res.getBody());
    return top[0].stId.replace(/R-([A-Z]*)-\d+/,'$1');
  }
}
var url = 'https://plantreactome.gramene.org/ContentService/data/species/all';
var res = request('GET', url);
if (res.statusCode == 200) {
  var PRspecies = JSON.parse(res.getBody());
  var lut = {};
  PRspecies.forEach(function(s) {
    lut[s.taxId] = s.abbreviation;
    lut[s.displayName] = s.abbreviation;
  });
  collections.maps.mongoCollection().then(function(mapsCollection) {
    // Every genome map needs a reactomePrefix, not just anchor genomes: the MAIN release has no
    // anchors (is_anchor:true matched 0 docs -> empty merge, failing the stage). anchor_taxon_id is
    // the real NCBI taxid (populated on all genome maps); fall back to floor(taxon_id/1000) since
    // maps taxon_id carries the *1000 pangenome offset. Reactome only covers ~145 species, so
    // genomes with no match are simply skipped (logged), not errored.
    mapsCollection.find({type:'genome'},{anchor_taxon_id:1,taxon_id:1,display_name:1}).toArray(function (err, docs) {
      var taxonomy = {};
      // collections.closeMongoDatabase();
      docs.forEach(function(doc) {
        var prefix;
        let tid = doc.anchor_taxon_id || Math.floor(doc.taxon_id / 1000);
        if (lut[tid]) {
          prefix = lut[tid];
        } else if(lut[doc.display_name]) {
          prefix = lut[doc.display_name];
        }
        if (prefix) {
          taxonomy[doc.taxon_id] = {
            reactomePrefix: prefix
          };
        }
        else {
          console.error("no reactome prefix found for map ", doc);
        }
      });
      console.log(JSON.stringify(taxonomy));
      collections.closeMongoDatabase();   // otherwise the open config connection hangs the process
    });
  });
}


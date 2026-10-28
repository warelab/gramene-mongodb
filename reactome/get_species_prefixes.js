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
  var prNames = [];
  PRspecies.forEach(function(s) {
    lut[s.taxId] = s.abbreviation;
    lut[s.displayName] = s.abbreviation;
    prNames.push({name: s.displayName, abbreviation: s.abbreviation});
  });

  // Last resort for a genome that neither key matched, when the two names differ only by how
  // specific they are. Release 70 had two such genomes, both of which DO have a Plant Reactome
  // projection that their own genes already cite:
  //   * triticum_spelta -- anchor taxid 58933, display name "Triticum spelta", while Plant Reactome
  //     lists "Triticum spelta subsp. spelta" under the subspecies taxid. Its genes carry R-TSP-*.
  //   * brassica_rapa_ro18 -- anchor taxid 1813537 (a B. rapa subspecies), display name "Brassica
  //     rapa R-o-18", while Plant Reactome lists plain "Brassica rapa". Its genes carry R-BRA-*.
  // Getting no prefix is not harmless: it leaves the species out of the hierarchy build entirely,
  // so its genes get pathway annotations (those come from the reactions file, which is keyed on
  // gene id) but no lineage_ field to render them against. Match when either name is a prefix of
  // the other at a word boundary, preferring the most specific Reactome name. This runs ONLY for a
  // genome that would otherwise get no prefix at all, so it cannot change an existing assignment.
  function prefixByName(displayName) {
    function boundary(longer, shorter) {
      if (longer.indexOf(shorter) !== 0) {
        return false;
      }
      var next = longer.charAt(shorter.length);
      return next === '' || !/[A-Za-z0-9]/.test(next);
    }
    var hits = prNames.filter(function(p) {
      return boundary(displayName, p.name) || boundary(p.name, displayName);
    });
    if (! hits.length) {
      return undefined;
    }
    hits.sort(function(a,b) { return b.name.length - a.name.length; });
    return hits[0];
  }
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
        } else {
          let byName = prefixByName(doc.display_name);
          if (byName) {
            prefix = byName.abbreviation;
            console.error(`prefix by name: ${doc.display_name} -> ${prefix} (Plant Reactome "${byName.name}")`);
          }
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


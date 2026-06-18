#!/usr/bin/env node
// build_taxon_remap.js — generate atlas/taxon_remap.json = { "<descendant taxon>": <genome taxon> }
// for EVERY NCBI taxon that is a DESCENDANT (subspecies / cultivar / strain / …) of a genome's
// species taxon, using the compara `ncbi_taxa_node` nested-set tree (left_index/right_index).
//
// Why: EBI Atlas experiments are tagged with an organism taxon that is sometimes a subspecies or
// cultivar BELOW a genome's species (e.g. maize subsp. 381124 under Zea mays 4577). Those taxa are
// NOT in the local pruned `taxonomy` collection (which holds genome taxa + their ANCESTORS only), so
// getAtlasData.js would drop the experiment at its `taxonomy.hasOwnProperty(taxon)` inclusion test.
// getAtlasData.js loads this map as `update_tid` and remaps such a taxon to the genome taxon, so the
// experiment is kept AND its assays are stored with the genome's taxon_id (so the downstream
// exact-taxon matches in the expression pipeline / scorer line up).
//
// Run before getAtlasData.js (wired into build/stages/55_atlas.sh). Connection comes from
// gramene-mongodb/ensembl_db_info.json (the same compara the maps loader uses).
var fs = require('fs');
var path = require('path');
var mysql = require('mysql2/promise');
var collections = require('gramene-mongodb-config');
var dbInfo = require('../ensembl_db_info.json').compara;

async function main() {
  // genome species taxa = the NCBI species id of every genome in this build (maps.taxon_id is
  // NCBI*1000+offset; //1000 collapses per-accession genomes back to their species).
  var mapsCol = await collections.maps.mongoCollection();
  var mapTaxa = await mapsCol.distinct('taxon_id');
  var genomeSpecies = [...new Set(mapTaxa.map(function (t) { return Math.floor(t / 1000); }))].filter(Boolean);
  console.error('genome species taxa: ' + genomeSpecies.length +
                ' [' + genomeSpecies.slice().sort(function (a, b) { return a - b; }).join(',') + ']');
  if (!genomeSpecies.length) throw new Error('no genome species taxa from maps — run 10_maps first');

  var db = await mysql.createConnection(dbInfo);
  try {
    var [gRows] = await db.query(
      'SELECT taxon_id,left_index,right_index FROM ncbi_taxa_node WHERE taxon_id IN (?)', [genomeSpecies]);
    var missing = genomeSpecies.filter(function (t) { return !gRows.find(function (r) { return r.taxon_id === t; }); });
    if (missing.length) console.error('  (not in ncbi_taxa_node, skipped: ' + missing.join(',') + ')');

    // for each genome species, map all its strict descendants -> that species.
    // deepest genome wins if a taxon falls under nested genome species (smallest range).
    var remap = {}; // desc -> { g, span }
    for (var i = 0; i < gRows.length; i++) {
      var g = gRows[i];
      var [desc] = await db.query(
        'SELECT taxon_id FROM ncbi_taxa_node WHERE left_index > ? AND right_index < ?',
        [g.left_index, g.right_index]);
      var span = g.right_index - g.left_index;
      for (var j = 0; j < desc.length; j++) {
        var t = desc[j].taxon_id;
        if (t === g.taxon_id) continue;
        if (!remap[t] || span < remap[t].span) remap[t] = { g: g.taxon_id, span: span };
      }
    }

    var out = {};
    Object.keys(remap).forEach(function (t) { out[t] = remap[t].g; });
    var outPath = path.join(__dirname, 'taxon_remap.json');
    fs.writeFileSync(outPath, JSON.stringify(out));
    console.error('wrote ' + outPath + ' with ' + Object.keys(out).length + ' descendant->genome taxon remaps');
  } finally {
    await db.end();
    collections.closeMongoDatabase();
  }
}

main().then(function () { process.exit(0); })
      .catch(function (e) { console.error('build_taxon_remap failed:', e && e.message || e); process.exit(1); });

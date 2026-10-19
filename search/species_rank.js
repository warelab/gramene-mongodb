// species_rank.js — the ONE definition of genes.species_idx, which drives the order genomes are
// presented in (solr sorts on species_idx, and the genes indexes lead with it).
//
// It lives here because decorate.js and redecorate.js each had their own copy and they DISAGREED,
// on both the ranks and the fallback:
//   decorate.js    sorghum 1, maize 2, rice 3, arabidopsis 4   fallback obj.taxon_id
//   redecorate.js  rice 1, arabidopsis 2, sorghum 3, maize 4   fallback Math.floor(taxon_id/1000)
// so running the incremental path after a full decorate silently re-ordered every genome.
//
// GRAMENE MAIN-RELEASE ORDER (this is not the SorghumBase order, which leads with sorghum):
//   arabidopsis, rice, maize, sorghum, grapevine,
//   then the remaining cultivar-set reference assemblies,
//   then every other genome.
//
// The cultivar-set references were identified by evidence rather than by guessing at names: of the
// ~130 oat/barley/wheat genomes in release 70, exactly 9 appear in the DEFAULT gene trees, and
// those are the reference-quality assemblies. Of those, the four that anchor a cultivar clusterset
// are below. The other five (triticum timopheevii/spelta/turgidum/dicoccoides/urartu) are distinct
// SPECIES rather than aestivum cultivars, so they fall in the general tail.
var speciesRank = {
  arabidopsis_thaliana : 1,
  oryza_sativa         : 2,   // rice; also the rice_cultivars reference
  zea_mays             : 3,   // was keyed `zea_maysb73` in decorate.js, which is not a release-70
                              // system_name, so maize never matched its rank at all
  sorghum_bicolor      : 4,
  vitis_vinifera       : 5,   // grapevine

  // remaining cultivar-set reference assemblies
  hordeum_vulgare      : 6,   // barley_cultivars reference (Morex), 35,229 genes in the default trees
  avena_sativa_sang    : 7,   // oat: BOTH are in the default trees, so both are references --
  avena_sativa_ot3098  : 8,   //      sang 80,403 and ot3098 57,958 genes
  triticum_aestivum    : 9    // wheat_cultivars reference (IWGSC), 107,319
};

// Unnamed genomes fall back to taxon_id, which is always far above the named ranks (the smallest
// synthetic taxon id in this release is ~3702001 against a maximum rank of 9), so the named tiers
// always sort first. decorate.js's fallback is kept; redecorate.js's /1000 variant is dropped
// because it only existed to differ.
function rankFor(obj) {
  var r = speciesRank[obj.system_name];
  return (r === undefined) ? obj.taxon_id : r;
}

module.exports = { speciesRank: speciesRank, rankFor: rankFor };

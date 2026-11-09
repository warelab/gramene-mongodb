// species_rank.js — the ONE definition of genes.species_idx, which drives the order genomes are
// presented in (solr sorts on species_idx, and the genes indexes lead with it).
//
// It lives here because decorate.js and redecorate.js each had their own copy and they DISAGREED,
// on both the ranks and the fallback:
//   decorate.js    sorghum 1, maize 2, rice 3, arabidopsis 4   fallback obj.taxon_id
//   redecorate.js  rice 1, arabidopsis 2, sorghum 3, maize 4   fallback Math.floor(taxon_id/1000)
// so running the incremental path after a full decorate silently re-ordered every genome.
//
// MAIZE SUBSITE ORDER. This is neither the Gramene main-release order (arabidopsis first) nor
// the SorghumBase one (sorghum first): a maize subsite leads with its own reference.
//
// Reproduced from the LIVE maize5 site rather than invented, so v6 presents genomes in the same
// order v5 does. Measured there:
//     zea_maysb73 1, arabidopsis_thaliana 2, oryza_sativa 3, sorghum_bicolor 4
// and every other genome on the taxon_id fallback -- including vitis_vinifera (29760001),
// chlamydomonas (3055001), drosophila (7227001), selaginella (88036001) and all 55 remaining
// zea/pan-maize assemblies (4576001, 4577001 ...). So the named tier is exactly these four.
//
// NB the key is `zea_maysb73`, NOT `zea_mays`. The main-release map keys maize as `zea_mays` and
// its own comment records that `zea_maysb73` "is not a release-70 system_name, so maize never
// matched its rank at all". On THIS site the reverse holds: maps has no `zea_mays`, and the
// reference assembly is `zea_maysb73` (44,303 genes). Keeping the release-70 key here would leave
// the reference unranked, drop it onto the taxon fallback, and hand species_idx 1 to arabidopsis
// -- which 60_solr_genes then asserts against the lowest gene_idx.
//
// The release-70 entries for vitis_vinifera, hordeum_vulgare, avena_sativa_* and triticum_aestivum
// are dropped: barley, oat and wheat are not in this site's 63 genomes at all, and ranking vitis
// 5th would put an outgroup ahead of 55 maize assemblies and disagree with v5.
// A SUBSITE leads with its own reference genome. Copied unchanged from maize this map ranks
// zea_maysb73 first -- and because the rice site hosts zea_maysb73, that silently makes the
// RICE site lead with maize. species_idx drives gene_idx, which drives presentation order and
// the freshness gate in 60_solr_genes (which only compares mongo's rank-1 genome against
// solr's lowest gene_idx, so it is satisfied either way and would not catch it).
//
// Live v9 ranks arabidopsis 1 / oryza_sativa 2 because its rank-3 key was `zea_mays`, which
// rice's maps do not contain -- the exact bug this file's own header describes. Rice first here.
var speciesRank = {
  oryza_sativa         : 1,   // IRGSP-1.0 Japonica reference, Os####g#######-keyed
  arabidopsis_thaliana : 2,
  sorghum_bicolor      : 3,
  zea_maysb73          : 4,   // B73 v5, an outgroup on this site
  zea_maysb73v4        : 5
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

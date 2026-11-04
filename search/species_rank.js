// species_rank.js — the ONE definition of genes.species_idx, which drives the order genomes are
// presented in (solr sorts on species_idx, and the genes indexes lead with it).
//
// It lives here because decorate.js and redecorate.js each had their own copy and they DISAGREED,
// on both the ranks and the fallback, so running the incremental path after a full decorate
// silently re-ordered every genome.
//
// GRAPEVINE SUBSITE ORDER (v5). This is NOT the Gramene main-release order, which leads with
// arabidopsis/rice/maize; on a grapevine pan-genome site the grape references lead.
//
// This is load-bearing, not cosmetic: 60_solr_genes.sh's freshness gate asserts that the lowest
// gene_idx in the solr core belongs to the genome mongo ranks species_idx:1. Rank 1 must therefore
// be the genome a user expects to see first.
//
// The two reference assemblies are the SAME genome at two annotation versions -- which is why the
// pathway crosswalk is called vv_orthologs.v3.v4.txt -- so the newer one leads:
//   vitis_viniferapn40024 taxon 29760020, "PN40024 v4", Vitvi-keyed, 35,197 genes. The CURRENT
//                         annotation, and the one the site itself targets: the grapevine entry in
//                         gramene-meta's demo.js sets targetTaxonId: 29760020 and aims curation at
//                         the same taxon. It is also the only Vitis genome that had pathways in v4.
//   vitis_vinifera        taxon 29760019, "PN40024 v3", VIT_-keyed, 29,971 genes. The superseded
//                         annotation. Still carried, and still the namespace the VIT_ Plant Reactome
//                         keys and vitis_synonym_adder target, which is why 25_reactome duplicates
//                         keys across the pair rather than rewriting onto one of them.
// Ranking v3 first would lead the site with the older annotation and disagree with targetTaxonId.
//
// Then the 29 other Vitis assemblies alphabetically — cultivars and wild species interleaved. That
// ordering is a deliberate default, not a biological claim: no assembly-quality or cultivated-first
// ranking was available, so alphabetical is used and recorded here so it can be changed knowingly.
// Then the 8 outgroups.
//
// NB the maize system_name on this site is `zea_maysb73`, not the main release's `zea_mays`.
var speciesRank = {
  vitis_viniferapn40024       : 1,
  vitis_vinifera              : 2,

  // the 29 other Vitis assemblies, alphabetical (a product ordering choice, documented)
  vitis_acerifolia            : 3,
  vitis_aestivalis            : 4,
  vitis_arizonica             : 5,
  vitis_berlanderi            : 6,
  vitis_cabfranc              : 7,
  vitis_cabsauvignon          : 8,
  vitis_carmenere             : 9,
  vitis_chardonnay            : 10,
  vitis_concord10x            : 11,
  vitis_corinthseeded         : 12,
  vitis_corinthseedless       : 13,
  vitis_flamepac              : 14,
  vitis_girdiana              : 15,
  vitis_malbecmagdeleine      : 16,
  vitis_malbecprunelard       : 17,
  vitis_merlot                : 18,
  vitis_monticola             : 19,
  vitis_mustangensis          : 20,
  vitis_nebbiolo              : 21,
  vitis_riesling              : 22,
  vitis_riparia               : 23,
  vitis_rotundifolia          : 24,
  vitis_rupestris             : 25,
  vitis_sylc12                : 26,
  vitis_syldvit3351           : 27,
  vitis_sylvs1                : 28,
  vitis_tempranilloalbillo    : 29,
  vitis_tempranillobenedicto  : 30,
  vitis_zinfandel             : 31,

  // outgroups last
  arabidopsis_thaliana        : 32,
  oryza_sativa                : 33,
  zea_maysb73                 : 34,
  sorghum_bicolor             : 35,
  solanum_lycopersicum        : 36,
  selaginella_moellendorffii  : 37,
  chlamydomonas_reinhardtii   : 38,
  drosophila_melanogaster     : 39
};

// Unnamed genomes fall back to taxon_id, which is always far above the named ranks (the smallest
// synthetic taxon id here is 3055001 against a maximum rank of 39), so the named tiers always sort
// first. All 39 genomes of this release are named above, so the fallback should never fire — it is
// kept so that adding a core does not silently produce an undefined species_idx.
function rankFor(obj) {
  var r = speciesRank[obj.system_name];
  return (r === undefined) ? obj.taxon_id : r;
}

module.exports = { speciesRank: speciesRank, rankFor: rankFor };

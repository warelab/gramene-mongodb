#!/usr/bin/env node
// setup reader
var n=0;
require('readline').createInterface(
  {
    input: process.stdin,
    terminal: false
  }
).on('line', function(line) { // one JSON object per line
  var mongo = JSON.parse(line);
  var location = mongo.location;
  var solr = {
    // required data for list view
    id          : mongo._id,
    name        : mongo.name,
    description : mongo.description,
    taxon_id    : mongo.taxon_id,

    // used to construct a link to ensembl
    system_name : mongo.system_name,
    schema_type : mongo.schema_type,

    // fields useful for genomic interval queries
    map         : location.map,
    region      : location.region,
    start       : location.start,
    end         : location.end,
    strand      : location.strand,
  };

  // facet counting on bin fields drives the taxagenomic distribution
  for (var field in mongo) {
    if (field.substr(-4) === '_bin') {
      solr[field] = mongo[field];
    }
  }

  // homology fields  
  if (mongo.hasOwnProperty('homology')) {
    solr.grm_gene_tree_root_taxon_id = mongo.grm_gene_tree_root_taxon_id;
    solr.epl_gene_tree = mongo.epl_gene_tree;
    solr.grm_gene_tree = mongo.grm_gene_tree;
    if (mongo.hasOwnProperty('epl_sibling_trees')) {
      solr.epl_sibling_trees = mongo.epl_sibling_trees;
    }
    for (htype in mongo.homologs) {
      solr['homology_'+htype] = mongo.homologs[htype];
    }
  }

  // protein annotation fields
  if (mongo.hasOwnProperty("canonical_translation")) {
    if (!!mongo.canonical_translation.domainRoots) {
      solr.domainRoots = mongo.canonical_translation.domainRoots;
    }
    ['avgResWeight','charge','isoPoint','length','molecularWeight'].forEach(function(fname) {
      solr['protein_'+fname] = mongo.canonical_translation[fname];
    });
  }

  // transcript properties
  if (mongo.hasOwnProperty('canonical_transcript')) {
    solr.transcript_length = mongo.canonical_transcript.length;
    solr.transcript_exons = mongo.canonical_transcript.exons.length;
  }

  // now deal with xrefs
  for (var db in mongo.xrefs) {
    if (!mongo.ancestors.hasOwnProperty(db)) { // aux cores
      solr[db + '_xrefs'] = mongo.xrefs[db];
    }
  }
  for (var c in mongo.ancestors) {
    solr[c + '_ancestors'] = mongo.ancestors[c];
  }

  if (n===0) console.log('[');
  else console.log(',');
  console.log(JSON.stringify(solr));
  n++;
}).on('close', function() {
  console.log(']');
});

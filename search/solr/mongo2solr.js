#!/usr/bin/env node
var fs = require('fs');
var filename = process.argv[2];

function add_xrefs(dest, src) {
  for(var db in src) {
    if (Array.isArray(src[db])) {
      if (typeof(src[db][0]) === 'number') {
        dest[db + '_xrefi'] = src[db];
      }
      else {
        dest[db + '_xrefs'] = src[db];
      }
    }
    else {
      // its an object with evidence code keys
      var any = {};
      for (var ec in src[db]) {
        dest[db + '_' + ec + '_xrefi'] = src[db][ec];
        for(var i=0; i < src[db][ec].length; i++) {
          any[src[db][ec][i]]=1;
        }
      }
      dest[db + '_xrefi'] = Object.keys(any).map(function(x){return +x});
    }
  }
}

function add_ancestors(dest, src) {
  for(var db in src) {
    dest[db + '_ancestors'] = src[db];
  }
}

// setup reader
var n=0;
require('readline').createInterface(
  {
    input: fs.createReadStream(filename),
    terminal: false
  }
).on('line', function(line) { // one JSON object per line
  var mongo = JSON.parse(line);
  var solr = {};
//  solr.id = mongo._id.$oid;
  solr.id          = mongo._id;
  solr.database    = mongo.database;
  solr.system_name = mongo.system_name;
  solr.biotype     = mongo.biotype;
  solr.taxon_id    = mongo.taxon_id;
  solr.species     = mongo.species;
  solr.name        = mongo.name;
  solr.description = mongo.description;
  solr.map         = mongo.location.map;
  solr.region      = mongo.location.region;
  solr.start       = mongo.location.start;
  solr.end         = mongo.location.end;
  solr.strand      = mongo.location.strand;
  
  if (mongo.hasOwnProperty('canonical_translation')) {
    solr.canonical_translation = mongo.canonical_translation.name;
    solr.canonical_translation_length = mongo.canonical_translation['length'];
  }
  if (mongo.hasOwnProperty('grm_gene_tree_root_taxon_id')) {
    solr.grm_gene_tree_root_taxon_id = mongo.grm_gene_tree_root_taxon_id;
  }
  
  for (var field in mongo) {
    if (field.substr(-4) === '_bin') {
      solr[field] = mongo[field];
    }
  }

  // for Surround Query Parser
  if (mongo.hasOwnProperty("domainRoots"))   solr.domainRoots = mongo.domainRoots;
  // multivalued distinct list of domains
  if (mongo.hasOwnProperty("domainList"))    solr.domainList  = mongo.domainList;
  // all of the domain hits
  if (mongo.hasOwnProperty("domainHits"))    solr.domainHits  = mongo.domainHits.map(function(d){return d.id+':'+d.s+'-'+d.e});
  
  if (mongo.hasOwnProperty("eg_gene_tree"))  solr.eg_gene_tree  = mongo.eg_gene_tree;
  if (mongo.hasOwnProperty("epl_gene_tree")) solr.epl_gene_tree = mongo.epl_gene_tree;
  if (mongo.hasOwnProperty("grm_gene_tree")) solr.grm_gene_tree = mongo.grm_gene_tree;
  if (mongo.hasOwnProperty("pathways"))      solr.pathways      = mongo.pathways;
  if (mongo.hasOwnProperty("reactions"))     solr.reactions     = mongo.reactions;

  // now deal with xrefs and protein_features
  add_xrefs(solr,mongo.xrefs);
  add_xrefs(solr,mongo.protein_features);
  add_ancestors(solr,mongo.ancestors);

  if (n===0) console.log('[');
  else console.log(',');
  console.log(JSON.stringify(solr));
  n++;
}).on('close', function() {
  console.log(']');
});

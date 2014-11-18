var fs = require('fs');
var filename = process.argv[2];

function add_xrefs(dest, src) {
  for(var db in src) {
    if (typeof(src[db][0]) === 'number') {
      dest[db + '_xrefi'] = src[db];
    }
    else {
      dest[db + '_xrefs'] = src[db];
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
  solr.id = mongo._id.$oid;
  solr.gene_id = mongo.gene_id;
  solr.database = mongo.database;
  solr.system_name = mongo.system_name;
  solr.taxon_id = mongo.taxon_id;
  solr.species = mongo.species;
  solr.name = mongo.name;
  solr.description = mongo.description;
  solr.biotype = mongo.biotype;
  solr.map = mongo.location.map;
  solr.region = mongo.location.region;
  solr.start = mongo.location.start;
  solr.end = mongo.location.end;
  solr.strand = mongo.location.strand;
  if (mongo.genetrees.length > 0) solr.genetrees = mongo.genetrees;
  // if (mongo.pathways) solr.pathways = mongo.pathways;
  // if (mongo.reactions) solr.reactions = mongo.reactions;

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

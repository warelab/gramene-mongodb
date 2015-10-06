#!/usr/bin/env node
var fs = require('fs');
var filename = process.argv[2];
var key = process.argv[3];
var assocs = require('./facet_counts.js');
var assoc = assocs[key+'_ancestors'];

// setup reader
var n=0;
require('readline').createInterface(
  {
    input: fs.createReadStream(filename),
    terminal: false
  }
).on('line', function(line) { // one JSON object per line
  var mongo = JSON.parse(line);
  var solr = mongo2solr[key](mongo);
  if (n===0) console.log('[');
  else console.log(',');
  console.log(JSON.stringify(solr));
  n++;
}).on('close', function() {
  console.log(']');
});

var optionalFields = ['comment','xref','synonym'];
var mongo2solr = {
  GO: function(doc) {
    var solr = {
      category: doc.namespace, // biological_process, molecular_function, cellular_component
      int_id: doc._id,
      id: doc.id,
      name: doc.name,
      def: doc.def,
      fq: 'GO_ancestors',
      relevance: assoc.hasOwnProperty(doc._id) ?
        doc.ancestors.length // more weight to more specific terms
      : 0.1 // demote GO terms with no genes associated with them
    };
    optionalFields.forEach(function(f) {
      if (doc.hasOwnProperty(f)) {
        solr[f] = doc[f];
      }
    });
    return solr;
  },
  PO: function(doc) {
    var solr = {
      category: doc.namespace, // plant_anatomy plant_structural_developmental_stage
      int_id: doc._id,
      id: doc.id,
      name: doc.name,
      def: doc.def,
      fq: 'GO_ancestors',
      relevance: assoc.hasOwnProperty(doc._id) ?
        doc.ancestors.length // more weight to more specific terms
      : 0.1 // demote GO terms with no genes associated with them
    };
    optionalFields.forEach(function(f) {
      if (doc.hasOwnProperty(f)) {
        solr[f] = doc[f];
      }
    });
    return solr;
  },
  NCBITaxon: function(doc) {
    var solr = {
      category: doc.namespace, // ncbi_taxonomy
      int_id: doc._id,
      id: doc.id,
      name: doc.name,
      fq: 'NCBITaxon_ancestors',
      relevance: assoc.hasOwnProperty(doc._id) ?
        doc.ancestors.length
      : 0.1
    };
    if (doc.hasOwnProperty('synonym')) {
      solr.synonym = doc.synonym;
    }
    return solr;
  },
  interpro: function(doc) {
    var solr = {
      category: doc.type, // Active_site Binding_site Conserved_site Domain Family PTM Repeat
      int_id: doc._id,
      id: doc.id,
      name: doc.name,
      description: doc.description,
      abstract: doc.abstract,
      xref: [],
      fq: 'interpro_ancestors',
      relevance: assoc.hasOwnProperty(doc._id) ?
        doc.ancestors.length
      : 0.1
    };
    for (var f in doc) {
      if (!(solr.hasOwnProperty(f) || f === 'ancestors' || f === 'type')) {
        if (Array.isArray(doc[f])) {
          Array.prototype.push.apply(solr.xref,doc[f]);
        }
        else {
          solr.xref.push(doc[f]);
        }
      }
    }
    return solr;
  }
};

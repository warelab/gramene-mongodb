#!/usr/bin/env node
var geneToOsReaction = {};
var geneToProjReaction = {};
require('readline').createInterface({
  input: require('fs').createReadStream(process.argv[2]),
  terminal: false
})
.on('line', function(line) {
  var fields = line.split("\t");
  if (fields.length === 8) {
    var Os_gene_id = fields[4];
    var Proj_gene_id = fields[6];
    var Os_reaction_id = fields[1];
    var Proj_reaction_id = fields[2];
    // rice gene to rice reaction
    if (!geneToOsReaction.hasOwnProperty(Os_gene_id)) {
      geneToOsReaction[Os_gene_id] = {};
    }
    geneToOsReaction[Os_gene_id][Os_reaction_id] = 1;
    // projected gene to rice reaction
    if (!geneToOsReaction.hasOwnProperty(Proj_gene_id)) {
      geneToOsReaction[Proj_gene_id] = {};
    }
    geneToOsReaction[Proj_gene_id][Os_reaction_id] = 1;
    // projected gene to projected reaction
    if (!geneToProjReaction.hasOwnProperty(Proj_gene_id)) {
      geneToProjReaction[Proj_gene_id] = {};
    }
    geneToProjReaction[Proj_gene_id][Proj_reaction_id] = 1;
    // rice gene to rice reaction, but in the geneToProjReaction hash
    if (!geneToProjReaction.hasOwnProperty(Os_gene_id)) {
      geneToProjReaction[Os_gene_id] = {};
    }
    geneToProjReaction[Os_gene_id][Os_reaction_id] = 1;
  }
})
.on('close', function() {
  // read genes documents
  require('readline').createInterface(
    {
      input: process.stdin,
      terminal: false
    }
  )
  .on('line', function(line) { // one JSON object per line
     var gene = JSON.parse(line);
     if (geneToOsReaction.hasOwnProperty(gene._id)) {
       gene.xrefs.pathways = Object.keys(geneToOsReaction[gene._id]); // these become pathways__ancestors in add_xref_ancestors.js
       gene.xrefs.reactions = Object.keys(geneToProjReaction[gene._id]); // these are for linking to plant reactome
     }
     console.log(JSON.stringify(gene));
  });
});

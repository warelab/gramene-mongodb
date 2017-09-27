#!/usr/bin/env node

// 1. get species in reactome from /data/species/main
// 2. for each species get the pathways and reactions from /data/eventsHierarchy/{species}
// 3. traverse each TopLevelPathway and generate a pathway document keyed off of the stId
//    strip the species prefix off of stId but we'll keep track of ancestors for each species.
//    That way, a gene from species x implicated in reaction r will be associated only with pathways that were
//    successfully projected to species x.

var argv = require('minimist')(process.argv.slice(2));
var request = require('sync-request');
var _ = require('lodash');
var readline = require('readline');
var fs = require('fs');

var genesToReactionsFile = argv.gtr || 'Ensembl2PlantReactomeReactions.txt';
var geneProductMappingFile = argv.gtp || 'gene_ids_by_pathway_and_species.tab';
var api = argv.api || 'http://plantreactome.gramene.org/ContentService';

var docs = {};
var taxonLUT = {}; // key is speciesCode, value is taxon id
var speciesResponse = request('GET', api + '/data/species/main');
if (speciesResponse.statusCode == 200) {
  var species = JSON.parse(speciesResponse.getBody());
  species.forEach(function(s) {
    var hierarchyResponse = request('GET', api + '/data/eventsHierarchy/' + s.taxId);
    if (hierarchyResponse.statusCode == 200) {
      var topLevelEvents = JSON.parse(hierarchyResponse.getBody());
      topLevelEvents.forEach(function(tle) {
        function parseEvent(event, taxon, ancestors) {
          [r,speciesCode,id] = event.stId.split('-');
          if(!taxonLUT.hasOwnProperty(speciesCode)) {
            taxonLUT[speciesCode] = taxon;
          }
          if (!docs.hasOwnProperty(id)) {
            docs[id] = {
              _id: +id,
              name: event.name,
              type: event.type
            };
          }
          if (event.type !== 'Reaction') {
            ancestors.push(+id);
          }
          var ancestorField = 'ancestors_' + taxon;
          if (docs[id].hasOwnProperty(ancestorField)) {
            // need to merge the ancestors from another path
            ancestors = _.uniq(_.concat(docs[id][ancestorField],ancestors));
          }
          docs[id][ancestorField] = ancestors;
          if (event.children) {
            event.children.forEach(function(child) {
              parseEvent(child, taxon, _.clone(ancestors));
            });
          }
        }
        parseEvent(tle,s.taxId,[]);
      });
    }
  });
}

// get the plant reactome gene xrefs from the geneProductMappingFile
var genes = {};
readline.createInterface({
  input: fs.createReadStream(geneProductMappingFile),
  terminal: false
})
.on('line', function(line) {
  var fields = line.split("\t");
  /*
0  plant reactome gene product id
1  pathway
2  species
3  gene id
  */
  genes[fields[3]] = {
    xrefs: [
      {
        db: 'reactome_gene_product',
        ids: [fields[0]]
      }
    ],
    annotations: {
      pathways: {
        ancestors: [],
        entries: []
      }
    }
  };
})
.on('close', function() {
  console.error('loaded geneProductMappings');
  // add ancestors to genes based on the hierarchy and the genesToReactionsFile
  readline.createInterface({
    input: require('fs').createReadStream(genesToReactionsFile),
    terminal: false
  })
  .on('line', function(line) {
    var fields = line.split("\t");
    /*
      fields are
  0  gene id
  1  reaction stable id
  2  pr link
  3  reaction name
  4  evidence code (always IEA?)
  5  species name
    */
    [r,speciesCode,id] = fields[1].split('-');
    if (docs.hasOwnProperty(id)) {
      var reactionAncestors = docs[id]['ancestors_' + taxonLUT[speciesCode]];
      if (!!genes[fields[0]].annotations.pathways.ancestors) {
        reactionAncestors = _.uniq(_.concat(genes[fields[0]].annotations.pathways.ancestors, reactionAncestors));
      }
      genes[fields[0]].annotations.pathways.ancestors = reactionAncestors;
      genes[fields[0]].annotations.pathways.entries.push({
        id: id,
        name: fields[3]
      });
    }
  })
  .on('close', function() {
    console.error('loaded genesToReactions');
    console.log(JSON.stringify(genes,null,'  '));
  });
});

//
// Object.values(docs).forEach(function(doc) {
//   console.log(JSON.stringify(doc));
// });


#!/usr/bin/env node

// 1. get species in reactome from /data/species/main
// 2. for each species get the pathways hierarchy from /data/eventsHierarchy/{species}
// 3. walk each TopLevelPathway and generate a pathway document keyed off of the stId, but
//    strip the species prefix off. We'll keep track of ancestors for each species.
//    That way, a gene from species x involved in reaction r will be associated only with pathways that were
//    successfully projected to species x.
// 4. Once this finishes, load the event documents into the pathways mongoDB collection.
// 5. Next, get xrefs for the gene product
// 6. Finally, go through the Ensembl2PlantToReactomeReactions.txt file and populate the pathway annotations
//    The output of the script is a JSON formatted object with gene stable id keys that will be used later
//    to update gene docs extracted from ensembl cores.

var argv = require('minimist')(process.argv.slice(2));
var request = require('sync-request');
var _ = require('lodash');
var readline = require('readline');
var fs = require('fs');
var collections = require('gramene-mongodb-config');

var genesToReactionsFile = argv.gtr || 'Ensembl2PlantReactomeReactions.txt';
var geneProductMappingFile = argv.gtp || 'gene_ids_by_pathway_and_species.tab';
var api = argv.api || 'https://plantreactome.gramene.org/ContentService';

var docs = {};
// merge_into_taxonomy.json is keyed the other way round from what we need here: one entry per
// GENOME taxon, each carrying that genome's reactomePrefix. A species with several genomes repeats
// its prefix on every one of them -- all 19 wheat genomes say TAE -- so collapsing it to a single
// taxon per prefix kept only whichever genome was iterated last and filed that species' whole
// hierarchy under it. Wheat's landed on triticum_aestivum_weebil (4565019), which left the
// reference triticum_aestivum (4565005) with no lineage_ field for its own genes to look up, and
// the Pathways tab reported no hierarchy for genes that plainly had pathways. Keep the entire
// group, and write each species' hierarchy under every genome that shares its prefix.
var prefixTaxa = {}; // key is speciesCode, value is every genome taxon carrying that prefix
var taxonLUT = {};   // key is speciesCode, value is one representative taxon of that group
var speciesPrefixes = require('./merge_into_taxonomy.json');
_.forEach(speciesPrefixes, function(value,key) {
  var prefix = value.reactomePrefix;
  if (! prefixTaxa.hasOwnProperty(prefix)) {
    prefixTaxa[prefix] = [];
  }
  prefixTaxa[prefix].push(+key);
  taxonLUT[prefix] = prefixTaxa[prefix][0];
});
var speciesResponse = request('GET', api + '/data/species/main');
if (speciesResponse.statusCode == 200) {
  var species = JSON.parse(speciesResponse.getBody());
  species.forEach(function(s) {
    console.error('GET', api + '/data/eventsHierarchy/' + s.taxId);
    var hierarchyResponse = request('GET', api + '/data/eventsHierarchy/' + s.taxId);
    if (hierarchyResponse.statusCode !== 200) {
      throw hierarchyResponse;
    }
    var topLevelEvents = JSON.parse(hierarchyResponse.getBody());
    topLevelEvents.forEach(function(tle) {
      function parseEvent(event, taxon, pathFromRoot) {
        if (! event.stId) {
          console.error('no stId', event);
        }
        else {
          [r,speciesCode,id] = event.stId.split('-');
          if(!taxonLUT.hasOwnProperty(speciesCode)) {
            console.error(`speciesCode ${speciesCode} not in taxonLUT`);
            taxonLUT[speciesCode] = taxon;
          }
          else if (taxon !== taxonLUT[speciesCode]) {
            console.error(`ensembl-reactome taxon mismatch resolved for ${speciesCode} ${taxonLUT[speciesCode]}-${taxon}`);
            taxon = taxonLUT[speciesCode];
          }
          if (!docs.hasOwnProperty(id)) {
            docs[id] = {
              _id: +id,
              name: event.name,
              type: event.type            
            };
          }
          var ancestorField = 'ancestors_' + taxon;
          var lineageField = 'lineage_' + taxon;
          pathFromRoot.push(+id);
          if (! docs[id].hasOwnProperty(lineageField)) {
            docs[id][lineageField] = [];
          }
          docs[id][lineageField].push(_.clone(pathFromRoot));
          docs[id][ancestorField] = _.uniq(_.flatten(docs[id][lineageField]));
          if (event.children) {
            event.children.forEach(function(child) {
              parseEvent(child, taxon, _.clone(pathFromRoot));
            });
          }
        }
      }
      parseEvent(tle,+s.taxId,[]);
    });
  });
}

// parseEvent wrote each species' hierarchy under the one representative taxon above; copy it to the
// rest of that prefix's genomes so a gene can find its own taxon's lineage_ field. Every genome in
// a group gets identical values -- the projection Plant Reactome publishes is per species, not per
// assembly -- so this is a fan-out, not a recomputation. Cloned rather than shared so that nothing
// downstream can mutate one genome's lineage through another's.
var fannedOut = 0;
_.forEach(docs, function(doc) {
  _.forEach(prefixTaxa, function(taxa, prefix) {
    var rep = taxonLUT[prefix];
    if (! doc.hasOwnProperty('lineage_' + rep)) {
      return; // this pathway is not projected to that species
    }
    taxa.forEach(function(taxon) {
      if (taxon === rep) {
        return;
      }
      doc['lineage_' + taxon]   = _.cloneDeep(doc['lineage_' + rep]);
      doc['ancestors_' + taxon] = _.clone(doc['ancestors_' + rep]);
      fannedOut++;
    });
  });
});
console.error(`fanned ${fannedOut} lineage/ancestors fields out to sibling genomes`);

// create an ancestors field for each doc that is the union of all the species specific fields
_.forEach(docs, function(doc, id) {
  var ancestors = _.reduce(doc, function(result, value, key) {
    if (key[0] === 'a') {
      value.forEach(function(v) {
        result[v] =1;
      })
    }
    return result;
  },{});
  doc.ancestors = Object.keys(ancestors).map(function(id){return +id});
});

// exit cleanly once BOTH the pathways insert and the genes->pathways stdout are
// done (the open config mongo connection would otherwise hang the process).
var doneInsert = false, doneGenes = false;
function maybeDone() { if (doneInsert && doneGenes) collections.closeMongoDatabase(); }

// insert docs to mongo
collections.pathways.mongoCollection().then(function(pathwaysCollection) {
  pathwaysCollection.remove({},function(err) {
    if (err) {
      throw err;
    }
    pathwaysCollection.insertMany(Object.values(docs),function(err, res) {
      if (err) {
        throw err;
      }
      console.error(`inserted ${res.insertedCount} events to pathways collection`);
      doneInsert = true; maybeDone();
    });
  });
});
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
        db: 'notGramene_Plant_Reactome',
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
      if (!genes.hasOwnProperty(fields[0])) {
        genes[fields[0]] = {
          annotations: {
            pathways: {
              ancestors: [],
              entries: []
            }
          }
        };
      }
      var reactionAncestors = docs[id]['ancestors_' + taxonLUT[speciesCode]];
      if (!!genes[fields[0]].annotations.pathways.ancestors) {
        reactionAncestors = _.uniq(_.concat(genes[fields[0]].annotations.pathways.ancestors, reactionAncestors));
      }
      // remove id from the reactionAncestors and put it in entries
      _.pull(reactionAncestors,+id);
      genes[fields[0]].annotations.pathways.ancestors = reactionAncestors;
      genes[fields[0]].annotations.pathways.entries.push({
        id: fields[1],
        link: fields[2],
        name: fields[3]
      });
    }
  })
  .on('close', function() {
    console.error('loaded genesToReactions');
    console.log(JSON.stringify(genes,null,'  '));
    doneGenes = true; maybeDone();
  });
});

//
// Object.values(docs).forEach(function(doc) {
//   console.log(JSON.stringify(doc));
// });


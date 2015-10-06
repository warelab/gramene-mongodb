#!/usr/bin/env node
var request = require('sync-request');
var _ = require('lodash');
var parseXML = require('xml2js').parseString;

var reactomeURL = process.argv[2];

var pathwayHierarchyURL = reactomeURL + '/pathwayHierarchy/oryza+sativa';
var queryByIdURL = reactomeURL + '/queryById/DatabaseObject/';

var cache = {};
var requests = 0;
var cacheHits = 0;
var nothingToSeeHere = {
  Complex : 1,
  SimpleEntity : 1
};

var body = request('GET', pathwayHierarchyURL).getBody();
parseXML(body, function(err, result) {
  var docs = {};
  addChildren(docs,[],result.Pathways.Pathway,'Pathway');
  for (var dbId in docs) {
    var doc = docs[dbId];
    doc._id = +dbId;
    // # populate ancestors
    if (doc.lineage.length == 1) {
      doc.ancestors = doc.lineage[0];
    }
    else {
      doc.ancestors = _.uniq(_.flatten(doc.lineage));
    }
    console.log(JSON.stringify(doc));
  }
});

function getFromPR(id) {  
  if (!cache.hasOwnProperty(id)) {
    requests++;
    cache[id] = JSON.parse(request('GET',queryByIdURL+id).getBody());
  } else {
    cacheHits++;
  }
  return cache[id];
}

function addChildren(docs, path, children, type) {
  children.forEach(function (child) {
    var dbId = child.$.dbId;
    var cpath = _(path).concat(+dbId).value();
    if (docs.hasOwnProperty(dbId)) {
      docs[dbId].lineage.push(cpath);
    }
    else {
      docs[dbId] = {
        name: child.$.displayName,
        lineage: [cpath],
        type: type
      };
      if (type === 'Reaction') {
        // need to query the REST API for more details
        var reaction = getFromPR(dbId);
        docs[dbId].synonyms = reaction.name; // reaction.displayName === reaction.name[0] ?
        if (reaction.hasOwnProperty('input')) {
          // if an input is a Complex, shoudl it be a document?
          // addChildren(docs, cpath,
          //   _.filter(reaction.input, function(d) {
          //     return d.schemaClass === 'Complex';
          //   }),
          // 'Complex');
          // // otherwise, just find the genes
          // else {
          //   var dig_here = _.filter(reaction.input, function(d) {
          //     return !nothingToSeeHere.hasOwnProperty(d.schemaClass]);
          //   });
          //   docs[dbId].input = findTheGenes(dig_here);
          // }
          docs[dbId].input = _.uniq(_.flattenDeep(findTheGenes(reaction.input)));
        }
        if (reaction.hasOwnProperty('output')) {
          // addChildren(docs, cpath,
          //   _.filter(reaction.output, function(d) {
          //     return d.schemaClass === 'Complex';
          //   }),
          // 'Complex');
          // // otherwise, just find the genes
          // else {
          //   var dig_here = _.filter(reaction.output, function(d) {
          //     return !nothingToSeeHere.hasOwnProperty(d.schemaClass]);
          //   });
          //   docs[dbId].output = findTheGenes(dig_here);
          // }
          docs[dbId].output = _.uniq(_.flattenDeep(findTheGenes(reaction.output)));
        }
        if (reaction.hasOwnProperty('catalystActivity')) {
          docs[dbId].catalyst = _.uniq(_.flattenDeep(findTheGenes(reaction.catalystActivity)));
        }
      }
    }
    if (child.hasOwnProperty('Pathway')) {
      addChildren(docs, cpath, child.Pathway, 'Pathway');
    }
    else if (child.hasOwnProperty('Reaction')) {
      addChildren(docs, cpath, child.Reaction, 'Reaction');
    }
  });
}

function findTheGenes(list) {
  var genes = [];
  list.forEach(function(item) {
    if (item.schemaClass === 'CatalystActivity') {
      var ca = getFromPR(item.dbId);
      if (ca.hasOwnProperty('physicalEntity')) {
        genes.push(findTheGenes([ca.physicalEntity]));
      }
    }
    else if (item.schemaClass === 'Complex') {
      var cx = getFromPR(item.dbId);
      genes.push(findTheGenes(cx.hasComponent));
    }
    else if (item.schemaClass === 'DefinedSet') {
      var ds = getFromPR(item.dbId);
      genes.push(findTheGenes(ds.hasMember));
    }
    else if (item.schemaClass === 'EntityWithAccessionedSequence') {
      var ewas = getFromPR(item.dbId);
      if (ewas.hasOwnProperty('referenceEntity')) {
        var re = getFromPR(ewas.referenceEntity.dbId);
        genes.push(re.identifier);
      }
    }
  });
  return genes;
}
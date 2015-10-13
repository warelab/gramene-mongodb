#!/usr/bin/env node
var request = require('sync-request');
var _ = require('lodash');
var parseXML = require('xml2js').parseString;

var reactomeURL = process.argv[2];

var pathwayHierarchyURL = reactomeURL + '/pathwayHierarchy/oryza+sativa';
var queryByIdURL = reactomeURL + '/queryById/DatabaseObject/';

var crawl = false; // there's a script that provides mappings from genes to pathways

var cache = {};

var body = request('GET', pathwayHierarchyURL).getBody();
parseXML(body, function(err, result) {
  var docs = {};
  addChildren(docs,[],result.Pathways.Pathway,'Pathway');
  for (var dbId in docs) {
    var doc = docs[dbId];
    doc.id = dbId;
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
    cache[id] = JSON.parse(request('GET',queryByIdURL+id).getBody());
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
        if (!!reaction.name) {
          docs[dbId].synonyms = reaction.name.filter(function(syn) {return syn !== reaction.displayName;});
        }
        if (crawl) {
          if (reaction.hasOwnProperty('input')) {
            docs[dbId].input = _.uniq(_.flattenDeep(findTheGenes(reaction.input)));
          }
          if (reaction.hasOwnProperty('output')) {
            docs[dbId].output = _.uniq(_.flattenDeep(findTheGenes(reaction.output)));
          }
          if (reaction.hasOwnProperty('catalystActivity')) {
            docs[dbId].catalyst = _.uniq(_.flattenDeep(findTheGenes(reaction.catalystActivity)));
          }
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
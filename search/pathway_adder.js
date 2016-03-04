#!/usr/bin/env node
var Q = require('q');
var through2 = require('through2');
var _ = require('lodash')


function buildLookupTable(filename) {
  var deferred = Q.defer();
  var lut = {
    geneToOsReaction : {},
    geneToProjReaction : {}
  };
  require('readline').createInterface({
    input: require('fs').createReadStream(filename),
    terminal: false
  })
  .on('line', function(line) {
  /*
  0  Os Reaction Name
  1  Os Reaction DB ID
  2  Proj Reaction DB ID
  3  Proj Reaction Species
  4  Os Gene Product Locus ID
  5  Os Gene Product DB ID
  6  Proj Gene Product Locus ID
  7  Proj Gene Product DB ID
  */
    var fields = line.split("\t");
    if (fields.length === 8) {
      var Os_gene_id = fields[4].toUpperCase();
      var Proj_gene_id = fields[6].toUpperCase();
      var Os_reaction_id = fields[1];
      var Proj_reaction_id = fields[2];
      // rice gene to rice reaction
      if (!lut.geneToOsReaction.hasOwnProperty(Os_gene_id)) {
        lut.geneToOsReaction[Os_gene_id] = {};
      }
      lut.geneToOsReaction[Os_gene_id][Os_reaction_id] = 1;
      // projected gene to rice reaction
      if (!lut.geneToOsReaction.hasOwnProperty(Proj_gene_id)) {
        lut.geneToOsReaction[Proj_gene_id] = {};
      }
      lut.geneToOsReaction[Proj_gene_id][Os_reaction_id] = 1;
      // projected gene to projected reaction
      if (!lut.geneToProjReaction.hasOwnProperty(Proj_gene_id)) {
        lut.geneToProjReaction[Proj_gene_id] = {};
      }
      lut.geneToProjReaction[Proj_gene_id][Proj_reaction_id] = 1;
      // rice gene to rice reaction, but in the geneToProjReaction hash
      if (!lut.geneToProjReaction.hasOwnProperty(Os_gene_id)) {
        lut.geneToProjReaction[Os_gene_id] = {};
      }
      lut.geneToProjReaction[Os_gene_id][Os_reaction_id] = 1;
    }
  })
  .on('close', function() {
    deferred.resolve(lut);
  });
  return deferred.promise;
}

module.exports = function(filename) {
  
  var lutPromise = buildLookupTable(filename);

  return through2.obj(function (gene, enc, done) {
    var that = this;
  
    if(!_.isObject(gene)) {
      throw new Error('gene is not an object');
    }
    lutPromise.then(function(lut) {
      var ID = gene._id.toUpperCase();
      if (lut.geneToOsReaction.hasOwnProperty(ID)) {
        gene.xrefs.push({db: 'pathways', ids: Object.keys(lut.geneToOsReaction[ID])});
        gene.xrefs.push({db: 'reactions', ids: Object.keys(lut.geneToProjReaction[ID]).map(function(r){return +r})});
      }
      that.push(gene);
      done();
    });
  });
}

#!/usr/bin/env node
var _ = require('lodash');
var collections = require('gramene-mongodb-config');
var Q = require('q');
var through2 = require('through2');

var xrefsToProcess = ['domains','GO','PO','taxonomy','pathways'];
var fields = {
  domains: ['id','name','description'],
  GO: ['id','name','namespace','def','subset'],
  PO: ['id','name','namespace','def','subset'],
  taxonomy: ['_id','name'],
  pathways: ['id','name']
};

function modifyGene(ancestorsLUT,obj) {
  obj.xrefs.taxonomy = ['NCBITaxon:'+obj.taxon_id]; // temporary xref to make loops happy
  xrefsToProcess.forEach(function(x) {
    if (obj.xrefs.hasOwnProperty(x)) {
      var lut = {};
      var specificAnnotations = [];
      var usefulInfo = {};
      obj.xrefs[x].forEach(function(id) {
        if (ancestorsLUT[x].hasOwnProperty(id)) {
          var intId = parseInt(id.match(/\d+/)[0]);
          specificAnnotations.push(intId);
          function subdoc(doc,fieldList) {
            var obj = {};
            fieldList.forEach(function(field) {
              obj[field] = doc[field];
            });
            return obj;
          }
          usefulInfo[intId] = subdoc(ancestorsLUT[x][id],fields[x]);
          ancestorsLUT[x][id].ancestors.forEach(function(anc) {
            if (anc !== intId) {
              lut[anc]=1;
            }
          });
        }
      });
      var msa = _.filter(specificAnnotations,function(id) {
        return !lut.hasOwnProperty(id);
      });
      if (!obj.annotations.hasOwnProperty(x)) {
        obj.annotations[x] = {};
      }
      obj.annotations[x].entries = msa.map(function(intId) {
        var doc = usefulInfo[intId];
        return doc;
      });
      if (Object.keys(lut).length > 0) {
        obj.annotations[x].ancestors = Object.keys(lut).map(function(a){return +a});
      }
      delete obj.xrefs[x];
    }
  });
  // delete obj.xrefs.taxonomy;
  // add ancestors of gene_tree root_taxon_id
  // if (obj.homology && obj.homology.gene_tree)) {
  //   obj.ancestors.gene_family = ancestorsLUT.taxonomy['NCBITaxon:'+obj.homology.gene_tree.root_taxon_id];
  // }
  return obj;
}

// create a lookup table from the documents in each aux core
var promises = xrefsToProcess.map(function(x) {
  var deferred = Q.defer();

  var coll = collections[x];
  coll.mongoCollection().then(function(mc) {
    var lut = {};
    mc.find().toArray(function (err, docs) {
      if (err) deferred.reject(err);
      docs.forEach(function(doc) {
        lut[doc.id] = doc;
      });
      deferred.resolve(lut);
    });
  });

  return deferred.promise;
});


module.exports = function() {
  
  var lutPromise = Q.all(promises).then(function(luts) {
    return _.zipObject(xrefsToProcess, luts);
  });
  
  return through2.obj(function (gene, enc, done) {
    var that = this;
    if(!_.isObject(gene)) {
      throw new Error('gene is not an object');
    }
    lutPromise.then(function(lut) {
      that.push(modifyGene(lut,gene));
      done();
    });
  });  
}



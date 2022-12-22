#!/usr/bin/env node
var _ = require('lodash');
var collections = require('gramene-mongodb-config');
var Q = require('q');
var through2 = require('through2');

var xrefsToProcess = ['domains','GO','PO','TO','taxonomy'];
var fields = {
  domains: ['id','name','description'],
  GO: ['id','name','namespace','def','subset'],
  PO: ['id','name','namespace','def','subset'],
  TO: ['id','name','namespace','def','subset'],
  taxonomy: ['_id','name'],
  familyRoot: ['_id','name']
};

function modifyGene(ancestorsLUT,obj) {
  obj.xrefs.push({db:'taxonomy', ids: ['NCBITaxon:'+obj.taxon_id]}); // temporary xref to make loops happy
  if (_.has(obj, 'homology.gene_tree.root_taxon_id')) {
    obj.xrefs.push({db:'familyRoot', ids: ['NCBITaxon:'+obj.homology.gene_tree.root_taxon_id]});
  }
  var xrefsKeys = _.keyBy(obj.xrefs,'db');
  xrefsToProcess.push('familyRoot');
  xrefsToProcess.forEach(function(x) {
    if (xrefsKeys.hasOwnProperty(x)) {
      var lut = {};
      var specificAnnotations = [];
      var usefulInfo = {};
      var revert = false;
      var LUT = (x === 'familyRoot') ? ancestorsLUT.taxonomy : ancestorsLUT[x];
      xrefsKeys[x].ids.forEach(function(id) {
        var ec;
        if (Array.isArray(id)) {
          ec = id[1];
          id = id[0];
        }
        if (LUT.hasOwnProperty(id)) {
          var intId = parseInt(id.match(/\d+/)[0]);
          specificAnnotations.push(intId);
          function subdoc(doc,fieldList) {
            var obj = {};
            fieldList.forEach(function(field) {
              obj[field] = doc[field];
            });
            return obj;
          }
          usefulInfo[intId] = subdoc(LUT[id],fields[x]);
          if (!!ec) {
            usefulInfo[intId].evidence_code = ec;
          }
          LUT[id].ancestors.forEach(function(anc) {
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
      delete xrefsKeys[x];
    }
  });
  xrefsToProcess.pop();
  // obj.xrefs = _.values(xrefsKeys);
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
        if (doc.alt_id) {
          doc.alt_id.forEach(function(id) {
            lut[id] = doc;
          });
        }
      });
      console.error(`ancestor_adder ${x} lookup table with ${docs.length}`);
      deferred.resolve(lut);
    });
  });
  return deferred.promise;
});


module.exports = function() {
  
  var lutPromise = Q.all(promises).then(function(luts) {
    console.error('ancestor_adder lookup tables done')
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



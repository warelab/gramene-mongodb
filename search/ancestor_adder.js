#!/usr/bin/env node
var _ = require('lodash');
var collections = require('gramene-mongodb-config');
var Q = require('q');
var through2 = require('through2');

// LUT_SOURCES drives both the lookup-table loading below and the zipObject that names
// the resulting LUTs, so it must stay immutable for the life of the process.
var LUT_SOURCES = ['domains','GO','PO','TO','taxonomy'];
// familyRoot and QTL_TO are processed per gene but reuse the taxonomy / TO tables rather
// than loading their own (see modifyGene). Built once here: this used to be done by
// push()ing onto the module-level list inside modifyGene and pop()ing at the end, which
// leaked two entries per gene and silently corrupted the list whenever modifyGene threw.
var XREFS_TO_PROCESS = LUT_SOURCES.concat(['familyRoot','QTL_TO']);
var fields = {
  domains: ['id','name','description'],
  GO: ['id','name','namespace','def','subset'],
  PO: ['id','name','namespace','def','subset'],
  TO: ['id','name','namespace','def','subset'],
  QTL_TO: ['id','name','namespace','def','subset'],
  taxonomy: ['_id','name'],
  familyRoot: ['_id','name']
};

function modifyGene(ancestorsLUT,obj) {
  obj.xrefs.push({db:'taxonomy', ids: ['NCBITaxon:'+obj.taxon_id]}); // temporary xref to make loops happy
  if (_.has(obj, 'homology.gene_tree.root_taxon_id')) {
    obj.xrefs.push({db:'familyRoot', ids: ['NCBITaxon:'+obj.homology.gene_tree.root_taxon_id]});
  }
  var xrefsKeys = _.keyBy(obj.xrefs,'db');
  XREFS_TO_PROCESS.forEach(function(x) {
    if (xrefsKeys.hasOwnProperty(x)) {
      var lut = {};
      var specificAnnotations = [];
      var usefulInfo = {};
      var revert = false;
      var LUT = ancestorsLUT[x];
      if (x === 'familyRoot') {
        LUT = ancestorsLUT.taxonomy
      }
      if (x === 'QTL_TO') {
        LUT = ancestorsLUT.TO
      }
      
      xrefsKeys[x].ids.forEach(function(id) {
        var ec;
        if (Array.isArray(id)) {
          ec = id[1];
          id = id[0];
        }
        if (LUT.hasOwnProperty(id)) {
          var digits = id.match(/\d+/);
          if (!digits) {
            throw new Error('ancestor_adder: ' + x + ' xref id "' + id + '" has no numeric part');
          }
          var intId = parseInt(digits[0]);
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
          // A LUT doc without an ancestors array is a data problem (e.g. a taxon that is in
          // the collection but was never given an ancestor chain). Name it explicitly --
          // this used to blow up as an opaque "cannot read property forEach of undefined".
          if (!Array.isArray(LUT[id].ancestors)) {
            throw new Error('ancestor_adder: ' + x + ' lookup doc "' + id +
                            '" has no ancestors array');
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
  // obj.xrefs = _.values(xrefsKeys);
  return obj;
}

// create a lookup table from the documents in each aux core
var promises = LUT_SOURCES.map(function(x) {
  var deferred = Q.defer();
  var coll = collections[x];
  coll.mongoCollection().then(function(mc) {
    var lut = {};
    mc.find().toArray(function (err, docs) {
      if (err) return deferred.reject(err); // without the return, docs is undefined below
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
    return _.zipObject(LUT_SOURCES, luts);
  });

  return through2.obj(function (gene, enc, done) {
    var that = this;
    if(!_.isObject(gene)) {
      // was a synchronous throw out of _transform; hand it to the stream instead so it
      // surfaces as a stream error with the rest of the pipeline's error handling.
      return done(new Error('ancestor_adder: gene is not an object'));
    }
    lutPromise.then(function(lut) {
      that.push(modifyGene(lut,gene));
      done();
    }).catch(function (err) {
      // CRITICAL: anything thrown inside this .then() used to reject silently, so done()
      // was never called and the whole decorate pipeline deadlocked with no output --
      // the process just sat idle in the event loop until it was killed. Always report
      // which gene failed and always settle the callback.
      console.error('ancestor_adder FAILED on gene ' + (gene && gene._id) + ': ' +
                    (err && err.stack || err));
      done(err instanceof Error ? err : new Error(String(err)));
    });
  });
}



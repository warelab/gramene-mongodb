#!/usr/bin/env node
var Q = require('q');
var through2 = require('through2');
var _ = require('lodash');
// OsNipp_IRGSP_MSU_lut.json adds MSU6 rice locus xrefs to the rice anchor genome.
// It is optional: if the LUT isn't present this adder degrades to a passthrough
// rather than crashing the whole decorate pipeline at load time.
var lut = {};
try {
  lut = require('./OsNipp_IRGSP_MSU_lut.json');
} catch (e) {
  console.error('msu6_adder: OsNipp_IRGSP_MSU_lut.json not found — skipping MSU6 rice xrefs');
}

function customizer(objValue, srcValue) {
  if (_.isArray(objValue)) {
    return objValue.concat(srcValue);
  }
}

module.exports = function() {
  console.error("msu6_adder lut with ",Object.keys(lut).length," genes");
  return through2.obj(function (gene, enc, done) {
    var that = this;

    if(!_.isObject(gene)) {
      throw new Error('gene is lacking needed info');
    }
    if (lut[gene._id]) {
      _.mergeWith(gene,lut[gene._id],customizer);
    }
    that.push(gene);
    done();
  });

}


#!/usr/bin/env node
var Q = require('q');
var through2 = require('through2');
var _ = require('lodash');
var lut = require('./OsNipp_IRGSP_MSU_lut.json');

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


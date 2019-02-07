#!/usr/bin/env node
var Q = require('q');
var through2 = require('through2');
var _ = require('lodash')

function concatArrays(objValue, srcValue) {
  if (_.isArray(objValue)) {
    return objValue.concat(srcValue);
  }
}

module.exports = function(lut) {
  
  return through2.obj(function (gene, enc, done) {
    var that = this;
  
    if(!_.isObject(gene)) {
      throw new Error('gene is not an object');
    }
    if (lut.hasOwnProperty(gene._id)) {
      _.mergeWith(gene,lut[gene._id], concatArrays);
    }
    else if (lut.hasOwnProperty(gene._id.toUpperCase())) {
      _.mergeWith(gene,lut[gene._id.toUpperCase()], concatArrays);
    }
    this.push(gene);
    done();
  });
}

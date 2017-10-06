#!/usr/bin/env node
var _ = require('lodash');
var argv = require('minimist')(process.argv.slice(2));

var lut = require(argv.l);

function customizer(objValue, srcValue) {
  if (_.isArray(objValue)) {
    return objValue.concat(srcValue);
  }
}

require('readline').createInterface(
  {
    input: process.stdin,
    terminal: false
  }
).on('line', function(line) { // one JSON object per line
  var mongo = JSON.parse(line);
  if (lut.hasOwnProperty(mongo._id)) {
    _.mergeWith(mongo,lut[mongo._id],customizer);
    console.log(JSON.stringify(mongo));
  }
});

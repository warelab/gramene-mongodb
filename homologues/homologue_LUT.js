var fs = require('fs');
var csv = require('csv-parser');
var Q = require('q');
var _ = require('lodash');
var lut = {};
function addToLut(keyProp, data) {
  var key, value;
  key = data[keyProp];
  value = lut[key];
  if(!value) {
    value = [data];
    lut[key] = value;
  }
  else {
    value.push(data);
  }
}

var start = new Date().getTime();
var last = start;
var count = 0;
var deferred = Q.defer();
fs.createReadStream('./homologue_edge.txt')
  .pipe(csv({separator: '\t' }))
  .on('data', function(data) {
    var now = new Date().getTime();
    addToLut(':START_ID(Gene)', data);
    addToLut(':END_ID(Gene)', data);
    ++count;
    if(now - last > 10000) {
      console.log(count, _.size(lut));
      last = now;
    }
  })
  .on('end', function() {
    console.log('Done in ', (new Date().getTime() - start) / 1000, ' seconds');
    console.log(count, _.size(lut));
    deferred.resolve(lut);
  });

module.exports = deferred.promise;


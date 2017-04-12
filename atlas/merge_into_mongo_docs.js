var argv = require('minimist')(process.argv.slice(2));

var lut = require(argv.l);

require('readline').createInterface(
  {
    input: process.stdin,
    terminal: false
  }
).on('line', function(line) { // one JSON object per line
  var mongo = JSON.parse(line);
  if (lut.hasOwnProperty(mongo._id)) {
    Object.keys(lut[mongo._id]).forEach(field => {
      mongo[field] = lut[mongo._id][field];
    });
    console.log(JSON.stringify(mongo));
  }
  else if (mongo.system_name == 'zea_mays') {
    if (mongo.synonyms) {
      var updated=false;
      mongo.synonyms.forEach(function(syn) {
        if (lut.hasOwnProperty(syn)) {
          updated=true;
          Object.keys(lut[syn]).forEach(field => {
            mongo[field] = lut[syn][field];
          });
        }
      });
      if (updated) {
        console.log(JSON.stringify(mongo));
      }
    }
  }
});

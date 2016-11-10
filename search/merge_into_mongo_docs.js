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
});

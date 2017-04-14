#!/usr/bin/env node
var tsvFiles = process.argv.slice(2);
var lut = {};
var remaining = tsvFiles.length;
tsvFiles.forEach(function(tsv) {
  var exp_id = tsv.replace('.tsv','');
  var fieldNames = [];
  require('readline').createInterface({
    input: require('fs').createReadStream(tsv),
    terminal: false
  })
  .on('line', function(line) {
    var fields = line.split("\t");
    if (fieldNames.length===0) {
      if (fields[0] === "Gene ID") {
        // found the header line
        fields.forEach(function(f) {
          fieldNames.push(f);
        });
      }
    }
    else {
      var samples = [];
      for (var i=2;i<fields.length;i++) {
        if (fields[i]) {
          var five = fields[i].split(',');
          samples.push({
            group: fieldNames[i],
            value: +five[2]
          });
        }
      }
      if (!lut.hasOwnProperty(fields[0])) {
        lut[fields[0]] = { _id: fields[0] };
      }
      lut[fields[0]][exp_id] = samples;
    }
  })
  .on('close', function() {
    remaining--;
    console.error('closing',tsv, remaining);
    if (remaining === 0) {
      var genes = Object.keys(lut);
      for(var i=0;i<genes.length;i++) {        
        console.log(JSON.stringify(lut[genes[i]]));
      }
    }
  });
});

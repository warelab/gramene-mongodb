#!/usr/bin/env node
var tsvFiles = process.argv.slice(2);
var lut = {};
var collections = require('gramene-mongodb-config');
var remaining = tsvFiles.length;

var mongoExpressionPromise = collections.expression.mongoCollection();

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
      if (fields[0] === "GeneID") {
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
      var myobj = [];
      for (var i=0;i<genes.length;i++) {
        myobj.push(lut[genes[i]]);
      }
      mongoExpressionPromise.then(function(expressionCollection) {
        expressionCollection.insertMany(myobj, function(err, response) {
          if (err) throw err;
          console.error("finished loading expression");
          collections.closeMongoDatabase();
        });
      });
    }
  });
});

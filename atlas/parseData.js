#!/usr/bin/env node
var tsvFiles = process.argv.slice(2);
var lut = {};
var collections = require('gramene-mongodb-config');
var remaining = tsvFiles.length;

var mongoExpressionPromise = collections.expression.mongoCollection();

tsvFiles.forEach(function(tsv) {
  let DEmode = tsv.includes('-analytics');
  let exp_id = tsv.replace('-tpms.tsv','');
  if (DEmode) {
    exp_id = tsv.replace('-analytics.tsv','');
  }
  let fieldNames = [];
  require('readline').createInterface({
    input: require('fs').createReadStream(tsv),
    terminal: false
  })
  .on('line', function(line) {
    let fields = line.split("\t");
    if (fieldNames.length===0) {
      if (fields[0] === "Gene ID" || fields[0] === "GeneID") {
        // found the header line
        fields.forEach(function(f) {
          fieldNames.push(f.replace(/\.p-value$/,''));
        });
      }
    }
    else {
      let samples = [];
      if (DEmode) {
        for (var i=2;i<fields.length;i+=2) {
          if (fields[i] !== "NA") {
            samples.push({
              group: fieldNames[i],
              p_value: +fields[i],
              l2fc: +fields[i+1]
            });
          }
        }
      }
      else {
        for (var i=2;i<fields.length;i++) {
          if (fields[i]) {
            var five = fields[i].split(',');
            samples.push({
              group: fieldNames[i],
              value: +five[2]
            });
          }
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
      let genes = Object.keys(lut);
      let myobj = [];
      for (var i=0;i<genes.length;i++) {
        myobj.push(lut[genes[i]]);
      }
      console.error('loading',genes.length,'genes with expression data');
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

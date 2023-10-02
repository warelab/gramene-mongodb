#!/usr/bin/env node
var lutFiles = process.argv.slice(2);
var lutFile = lutFiles.pop();
var lut = {};
var collections = require('gramene-mongodb-config');
var mongoExpressionPromise = collections.expression.mongoCollection();

require('readline').createInterface({
  input: require('fs').createReadStream(lutFile),
  terminal: false
})
.on('line', function(line) {
  var fields = line.split("\t");
  if (!lut.hasOwnProperty(fields[1])) {
    lut[fields[1]] = [];
  }
  lut[fields[1]].push(fields[0]);
})
.on('close', function() {
  console.error('closing',lutFile);
  mongoExpressionPromise.then(function(expressionCollection) {
    expressionCollection.find({}).toArray(function(err, genes) {
      var myObj = [];
      genes.forEach(function(gene) {
        if (lut.hasOwnProperty(gene._id)) {
          lut[gene._id].forEach(function(new_id) {
            var g2 = Object.assign({}, gene);
            g2._id = new_id;
            myObj.push(g2);
          });
        }
      });
      console.error(`remapped expression for ${myObj.length} genes`);
      expressionCollection.insertMany(myObj, function(err, response) {
        if (err) throw err;
        console.error("finished loading remapped expression");
        collections.closeMongoDatabase();
      });
    });
  });
});

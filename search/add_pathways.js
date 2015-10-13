#!/usr/bin/env node
var gene2reaction = {};
require('readline').createInterface({
  input: require('fs').createReadStream(process.argv[2]),
  terminal: false
})
.on('line', function(line) {
  var fields = line.split("\t");
  if (fields.length === 6) {
    if (!gene2reaction.hasOwnProperty(fields[4])) {
      gene2reaction[fields[4]] = [];
    }
    gene2reaction[fields[4]].push(fields[1]);
  }
})
.on('close', function() {
  // read genes documents
  require('readline').createInterface(
    {
      input: process.stdin,
      terminal: false
    }
  )
  .on('line', function(line) { // one JSON object per line
     var gene = JSON.parse(line);
     if (gene2reaction.hasOwnProperty(gene._id)) {
       gene.xrefs.pathways = gene2reaction[gene._id];
     }
     console.log(JSON.stringify(gene));
  });
});

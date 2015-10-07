#!/usr/bin/env node
var client = require('redis').createClient();
client.select(1, function(err) {
  if (err) throw err;
  require('readline').createInterface({
    input: process.stdin,
    terminal: false
  }).on('line', function (line) { // one JSON object per line
    var obj = JSON.parse(line);
    client.hgetall(obj._id, function (err, homologs) {
      if (err) throw err;
      homology = {};
      for (var gene in homologs) {
        var k = homologs[gene];
        if (!homology.hasOwnProperty(k)) {
          homology[k] = [];
        }
        homology[k].push(gene);
      }
      if (Object.keys(homology).length > 0) {
        obj.homology = homology;
      }
      console.log(JSON.stringify(obj));
    });
  }).on('close', function() {
    client.quit();
  });
});

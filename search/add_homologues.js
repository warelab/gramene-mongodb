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
      if (!obj.hasOwnProperty('homology')) {
        obj.homology = {};
      }
      for (var gene in homologs) {
        var k = homologs[gene];
        if (!obj.homology.hasOwnProperty(k)) {
          obj.homology[k] = [];
        }
        obj.homology[k].push(gene);
      }
      console.log(JSON.stringify(obj));
    });
  }).on('close', function() {
    client.quit();
  });
});

#!/usr/bin/env node
var Q = require('q');

get_curated().then(function(curated) {
  console.log(JSON.stringify(curated));
  // collections.curated.mongoCollection().then(function(mongoCurated) {
  //   mongoCurated.insertMany(curated, function(err, result) {
  //     if (err) {
  //       throw err;
  //     }
  //     console.log("finished loading curated");
  //     collections.closeMongoDatabase();
  //   })
  // })
})

async function get_thalemine() {
  var url = 'https://bar.utoronto.ca/thalemine/service/query/results?query=%3Cquery+name%3D%22%22+model%3D%22genomic%22+view%3D%22Gene.primaryIdentifier+Gene.symbol+Gene.tairCuratorSummary+Gene.briefDescription%22+longDescription%3D%22%22+sortOrder%3D%22Gene.primaryIdentifier+asc%22%3E%3Cconstraint+path%3D%22Gene.symbol%22+op%3D%22IS+NOT+NULL%22%2F%3E%3C%2Fquery%3E&format=tab';
  const response = await fetch(url);
  const body = await response.text();
  var lines = body.split("\n");
  let res = [];
  lines.forEach(function(line) {
    if (line) {
      var cols = line.split("\t");
      if (cols[2] && cols[2].length > 10) {
        res.push(cols[0]);
      }
    }
  });
  return res;
}

function get_rapdb() {
  var deferred = Q.defer();
  var url = 'https://rapdb.dna.affrc.go.jp/curated_genes/curated_genes.json'
  url = 'https://dev.gramene.org/oryza/rapdb/curated_genes.json' // local mirror
  console.error('rapdb get('+url+')');
  fetch(url)
  .then(res => res.json())
  .then(genes => {
    var lut = {};
    genes.forEach(g => {
      if (!lut.hasOwnProperty(g.locus)) {
        lut[g.locus] = 1;
      }
    });
    console.error('rapdb lookup table');
    deferred.resolve(Object.keys(lut));
  });

  return deferred.promise;
}
function getRedis(db) {
  var deferred = Q.defer();
  var client = require('redis').createClient();
  client.select(db, function(err) {
    if (err) throw err;
    console.error('generifs redis connection established');
    deferred.resolve(client);
  });
  return deferred.promise;
}

function get_generif(db) {
  var deferred = Q.defer();
  
  var redisPromise = getRedis(db);
  
  redisPromise.then(function(client) {
    client.keys("*", function (err, keystr) {
      if (err) throw err;
      client.quit();
      deferred.resolve(keystr);
    });
  });
  return deferred.promise;
}

async function get_curated() {
  const thalemine = await get_thalemine();
  const rapdb = await get_rapdb();
  const generif = await get_generif(3);
  let res = {};
  thalemine.forEach(g => {
    if (!res.hasOwnProperty(g)) res[g] = {sources:[]}
    res[g].sources.push("thalemine");
  });
  rapdb.forEach(g => {
    if (!res.hasOwnProperty(g)) res[g] = {sources:[]}
    res[g].sources.push("rapdb");
  });
  generif.forEach(g => {
    if (!res.hasOwnProperty(g)) res[g] = {sources:[]}
    res[g].sources.push("generif");
  });
  return res;
}

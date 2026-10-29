#!/usr/bin/env node
var Q = require('q');

get_curated().then(function(curated) {
  console.log(JSON.stringify(curated));
  // the redis client opened by get_generif keeps the event loop alive; exit
  // explicitly once the curated json has been written to stdout.
  process.exit(0);
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
  // Upstream first, the dev.gramene.org mirror as fallback. The old hardcoded affrc.go.jp host does
  // not answer at all, and it was dead code anyway -- the next line overwrote it with the mirror.
  // The fetch is guarded because it was not: a bare fetch().then(res => res.json()) with no timeout,
  // no res.ok check and no .catch makes a slow mirror an uncaught rejection that kills this stage,
  // and dev.gramene.org does intermittently connect-time-out.
  var urls = [
    'https://rapdb.dna.naro.go.jp/curated_genes/curated_genes.json',
    'https://dev.gramene.org/oryza/rapdb/curated_genes.json'
  ];
  function attempt(i) {
    if (i >= urls.length) {
      console.error('rapdb: every source URL failed -- continuing with no rapdb loci');
      return Q.resolve([]);
    }
    console.error('rapdb get(' + urls[i] + ')');
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 60000);
    return Q(fetch(urls[i], {signal: ctrl.signal})
      .then(function (res) {
        clearTimeout(timer);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      }))
      .then(function (genes) {
        var lut = {};
        genes.forEach(function (g) { if (g && g.locus) lut[g.locus] = 1; });
        console.error('rapdb lookup table: ' + Object.keys(lut).length + ' loci');
        return Object.keys(lut);
      })
      .catch(function (err) {
        clearTimeout(timer);
        console.error('rapdb fetch failed for ' + urls[i] + ' (' + err.message + ')');
        return attempt(i + 1);
      });
  }
  return attempt(0);
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

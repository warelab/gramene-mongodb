#!/usr/bin/env node
// load interpro hierarchy into a hash
// root{ipr} = root

// iterate over genes documents
/*

domain architecture

Extract the interpro domain hits on canonical trans of each gene in the db
only consider “Domain” type within interpro
merge signatures in the same ipr entry or hierarchy if 20% overlap w.r.t. shorter match
create space separated search string of root level IPR entries (one per cluster - sorted by start,end)
maintain comma separated distinct IPR entries for more precise scoring of matches

example interpro hierarchies:

E
ED
EDA
EDB
EC
F
G
GH
GI

protein p1 has 3 annotated domains: A F H which become search string "E F G"

query D F I becomes query string w(E, F, G) which finds p1.

then we have to use the hierarchy to score the match
A F H
1+0+2 = 3
D F I

In order to score the matches you need the hierarchies of each domain. Matches from solr don't need to store the path to the root because the same hierarchies are available from the query. A node service for this search will query solr and score the matches. What about pagination? Use a web cache to store results in batches to support pagination.
If there is an intermediate service, the interpro hierarchies can be kept in memory.
*/
var mongoURL = 'mongodb://127.0.0.1:27017/ontology';
var MongoClient = require('mongodb').MongoClient;
var fs = require('fs');
var genes_fn = process.argv[2];
MongoClient.connect(mongoURL, function(err, db) {
  if (err) throw err;
  // fetch all the interpro docs and build a hierarchy root lookup table hroot[this_ipr] = root_ipr;
  var coll = db.collection("interpro");
  coll.find({type:'Domain'}, {fields:{ancestors:1}}).toArray(function(err, result) {
    if (err) throw err;
    var hroot = {};
    var depth = {};
    result.forEach(function(doc) {
      var this_ipr = doc._id;
      depth[this_ipr] = doc.ancestors.length;
      var root_ipr = doc.ancestors.pop();
      hroot[this_ipr] = root_ipr;
    });
    db.close();
    // setup reader
    require('readline').createInterface({
        input: fs.createReadStream(genes_fn),
        terminal: false
    }).on('line', function(line) { // one JSON object per line
      var obj = JSON.parse(line);
      if (obj.hasOwnProperty('interpro_hits')) {
        var ipr_hits = [];
        for (var ipr in obj.interpro_hits) {
          var ipr_i = parseInt(ipr.match(/\d+/));
          var hits = []
          obj.interpro_hits[ipr].forEach(function(interval) {
            var hit = {
              start: interval[0],
              end: interval[1]
            };
            if (hroot.hasOwnProperty(ipr_i)) {
              interval.push(ipr_i,hroot[ipr_i]);
              ipr_hits.push(interval);
              hit.root = hroot[ipr_i];
            }
            hits.push(hit);
          });
          obj.interpro_hits[ipr_i] = hits;
          delete obj.interpro_hits[ipr];
        }
        if (ipr_hits.length > 0) {
          ipr_hits.sort(function(a,b) {
            if (a[3] < b[3]) {return -1}
            if (a[3] > b[3]) {return 1}
            if (a[0] < b[0]) {return -1}
            if (a[0] > b[0]) {return 1}
            if (a[1] < b[1]) {return -1}
            return 1;
          });
          var clusters = [];
          var clust = {
            start : ipr_hits[0][0],
            end: ipr_hits[0][1],
            iprs: [0],
            root: ipr_hits[0][3]
          };
          for (var i=1;i<ipr_hits.length; i++) {
            var done=1;
            var hit = ipr_hits[i];
            if (hit[3] === clust.root) {
              if (hit[0] < clust.end) {
                if (hit[1] < clust.end) {
                  clust.iprs.push(i);
                  done=0;
                }
                else {
                  var overlap = clust.end - hit[0];
                  if (overlap/(hit[1] - hit[0]) >= 0.2 || overlap/(clust.end-clust.start) >= 0.2) {
                    clust.iprs.push(i);
                    clust.end = hit[1];
                    done=0;
                  }
                }
              }
            }
            if (done) {
              clusters.push(clust);
              clust = {
                start: hit[0],
                end: hit[1],
                iprs: [i],
                root: hit[3]
              };
            }
          }
          clusters.push(clust);
          // sort clusters
          clusters.sort(function(a,b) {
            if (a.start < b.start) {return -1}
            if (a.start > b.start) {return 1}
            if (a.end < b.end) {return -1}
            return 1;
          });
          var roots = [];
          obj.domainList = [];
          obj.domainHits = [];
          var distinctDomains = {};
          clusters.forEach(function(c) {
            roots.push(c.root);
            obj.domainHits.push({id:c.root,s:c.start,e:c.end});
            distinctDomains[c.root]=1; // to make sure we have the root id
            c.iprs.forEach(function(i) {
              distinctDomains[ipr_hits[i][2]]=1; // add non-root domain ids
              // obj.domainHits.push({id:ipr_hits[i][2],s:ipr_hits[i][0],e:ipr_hits[i][1]});
            });
          });
          obj.domainList = Object.keys(distinctDomains).map(function(d){return +d});
          obj.domainRoots = roots.join(' ');
        }
      }
      console.log(JSON.stringify(obj));
    });
  });
});
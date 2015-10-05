#!/usr/bin/env node
// load interpro hierarchy into a hash
// root{ipr} = root

// iterate over genes documents
/*

domain architecture

Extract the interpro domain hits on canonical trans of each gene in the db
only consider “Domain” or "Family" type within interpro
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
var domains = require('../config/collections.js').domains;
var mongoURL = 'mongodb://'
  + domains.host + ':' + domains.port + '/' + domains.dbName;
var MongoClient = require('mongodb').MongoClient;
MongoClient.connect(mongoURL, function(err, db) {
  if (err) throw err;
  // fetch all the interpro docs and build a hierarchy root lookup table hroot[this_ipr] = root_ipr;
  var coll = db.collection(domains.collectionName);
  coll.find({}, {fields:{ancestors:1,type:1,id:1,name:1,description:1}}).toArray(function(err, result) {
    if (err) throw err;
    var hroot = {};
    var pathFromRoot = {};
    var info = {};
    result.forEach(function(doc) {
      info[doc._id] = {
        interpro: doc.id,
        name: doc.name,
        type: doc.type,
        description: doc.description
      };
      doc.ancestors.reverse();
      pathFromRoot[doc._id] = doc.ancestors;
      if (doc.type === 'Domain') {
        hroot[doc._id] = doc.ancestors[0];
      }
    });
    db.close();
    // setup reader
    require('readline').createInterface({
        input: process.stdin,
        terminal: false
    }).on('line', function(line) { // one JSON object per line
      var obj = JSON.parse(line);
      if (obj.hasOwnProperty('canonical_translation')) {
        // group features by domain hierarchy root
        var arch = {};
        var interproSet = {};
        var features = obj.canonical_translation.features;
        features.all.forEach(function(feature) {
          interproSet[feature.interpro]=1;
          var ipr_i = parseInt(feature.interpro.match(/\d+/));
          feature.ipr = ipr_i;
          if (hroot.hasOwnProperty(ipr_i)) {
            if (!arch.hasOwnProperty(hroot[ipr_i])) {
              arch[hroot[ipr_i]] = {domains:[]};
            }
            arch[hroot[ipr_i]].domains.push(feature);
          }
          else if (info.hasOwnProperty(ipr_i)) { // things that are not going into domainArchitecture
            var type = info[ipr_i].type;
            if (!features.hasOwnProperty(type)) {
              features[type] = [];
            }
            features[type].push(feature);
          }
          else {
            console.error(obj._id,'ignoring deprecated feature',feature.interpro);
          }
        });
        delete features.all;
        var uniqueIPRs = Object.keys(interproSet);
        if (uniqueIPRs.length > 0) {
          obj.xrefs.interpro = uniqueIPRs;
        }
        // merge overlapping domains into clusters
        // and assign them the ipr id of their lca instead of the root?
        var clusters = [];
        for (var root in arch) {
          arch[root].domains.sort(function(a,b) {
            if (a.start < b.start) { return -1 }
            if (a.start > b.start) { return 1 }
            if (a.end < b.end) { return -1 }
            if (a.end > b.end) { return 1 }
            return 1;
          });
          var ipr = arch[root].domains.shift();

          var clust = {
            root: root,
            start: ipr.start,
            end: ipr.end,
            members: [ipr]
          };
          var done=0;
          arch[root].domains.forEach(function(ipr) {
            done=1;
            if (ipr.start < clust.end) {
              if (ipr.end < clust.end) {
                clust.members.push(ipr);
                done=0;
              }
              else {
                var overlap = clust.end - ipr.start;
                if (overlap/(ipr.end - ipr.start) >= 0.2 || overlap/(clust.end-clust.start) >= 0.2) {
                  clust.members.push(ipr);
                  clust.end = ipr.end;
                  done=0;
                }
              }
            }
            if (done) {
              clusters.push(clust);
              clust = {
                root: root,
                start: ipr.start,
                end: ipr.end,
                members: [ipr]
              };
            }
          });
          if (!done) clusters.push(clust);
        }
        // sort clusters
        clusters.sort(function(a,b) {
          if (a.start < b.start) {return -1}
          if (a.start > b.start) {return 1}
          if (a.end < b.end) {return -1}
          return 1;
        });
        // set interpro of each cluster to LCA of members
        // and set name and description based on lca
        obj.canonical_translation.features.domainArchitecture = clusters.map(function(c) {
          var iprList = c.members.map(function(m) {
            return m.ipr
          });
          function lca(ids, idPath) {
            if (ids.length === 1) return ids[0];
            var lca = ids.shift();
            ids.forEach(function(id) {
              var p1 = idPath[lca];
              var p2 = idPath[id];
              var n = p1.length < p2.length ? p1.length : p2.length; 
              var i=1;
              while (i<n && p1[i] === p2[i]) {i++}
              lca = p1[i-1];
            });
            return lca;
          }
          var lca_ipr = lca(iprList, pathFromRoot);
          c.interpro = info[lca_ipr].interpro;
          c.name = info[lca_ipr].name;
          c.description = info[lca_ipr].description;
          return c;
        });
        // need the domain root ids put into a space delimited string for searching
        obj.canonical_translation.domainRoots = clusters.map(function(c) {
          return c.root;
        }).join(' ');
      }
      console.log(JSON.stringify(obj,function(k,v) {
        if (k === "ipr") return undefined;
        else return v;
      }));
    });
  });
});
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
var Q = require('q');
var through2 = require('through2');
var _ = require('lodash')
var collections = require('gramene-mongodb-config');

function getDomains() {
  var deferred = Q.defer();

  collections.domains.mongoCollection().then(function(coll) {
    // fetch all the interpro docs and build a hierarchy root lookup table hroot[this_ipr] = root_ipr;
    coll.find({}, {fields:{ancestors:1,type:1,id:1,name:1,description:1}}).toArray(function(err, result) {
      // collections.closeMongoDatabase();
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
      deferred.resolve({
        hroot: hroot,
        pathFromRoot: pathFromRoot,
        info: info
      });
    });
  });
  return deferred.promise;
}

module.exports = function() {
  
  var domainsPromise = getDomains();
  
  return through2.obj(function (gene, enc, done) {
    var that = this;

    console.error("domainArchitect got gene ",gene._id);

    domainsPromise.then(function(domainData) {
      var hroot = domainData.hroot;
      var pathFromRoot = domainData.pathFromRoot;
      var info = domainData.info;
      var interproSet = {};
      console.error("domainArchitect working on gene ",gene._id);
      for(var transcript_id in gene.gene_structure.transcripts) {
        var transcript = gene.gene_structure.transcripts[transcript_id];
        if (transcript.hasOwnProperty('translation')) {
          // group features by domain hierarchy root
          var arch = {};
          var features = transcript.translation.features;
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
            if (info.hasOwnProperty(ipr_i)) {
              var type = info[ipr_i].type.toLowerCase();
              if (!features.hasOwnProperty(type)) {
                features[type] = {entries:[]};
              }
              features[type].entries.push(feature);
            }
            else {
              // console.error(obj._id,'ignoring deprecated feature',feature.interpro);
            }
          });
          delete features.all;
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
          if (clusters.length !== 0) {
            // sort clusters
            clusters.sort(function(a,b) {
              if (a.start < b.start) {return -1}
              if (a.start > b.start) {return 1}
              if (a.end < b.end) {return -1}
              return 1;
            });
            // set interpro of each cluster to LCA of members
            // and set name and description based on lca
            features.domain.architecture = clusters.map(function(c) {
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
              delete c.members;
              return c;
            });
            // need the domain root ids put into a space delimited string for searching
            features.domain.roots = clusters.map(function(c) {
              return c.root;
            }).join(' ');
          }
        }
      }
      var uniqueIPRs = Object.keys(interproSet);
      if (uniqueIPRs.length > 0) {
        gene.xrefs.domains = uniqueIPRs;
      }

      // console.log(JSON.stringify(obj,function(k,v) {
      //   if (k === "ipr") return undefined;
      //   else return v;
      // }));
  
      console.error("domainArchitect done with gene ",gene._id);
      that.push(gene);
      done();
    });
  });  
}

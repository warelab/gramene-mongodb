#!/usr/bin/env node
var Q = require('q');
var through2 = require('through2');
var _ = require('lodash');

const ontologies = ['po','to'];
function getRapDB() {
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
        lut[g.locus] = {
          name:'',
          synonyms:[],
          refs:[]
        };
        ontologies.forEach(o => lut[g.locus][o] = {});
      }
      _.forEach(g.references, function(ref, pmid) {
        if (_.isObject(ref) && _.isNumber(+pmid)) {
          lut[g.locus].refs.push({
            id: pmid,
            title: ref.title
          })
        }
        else {
          console.error('skipping reference',ref,pmid);
        }
      });
      if (g.gene_symbols) {
        let symbols = g.gene_symbols.split(', ');
        lut[g.locus].name = symbols.shift();
        lut[g.locus].synonyms = _.uniq(symbols);       
      }
      ontologies.filter(o => g[o]).forEach(o => g[o].forEach(term => {
        const idx = term.indexOf(' ');
        const id = term.substring(0, idx);
        lut[g.locus][o][id]=1;
      }))
    });
    console.error('rapdb lookup table');
    deferred.resolve(lut);
  });

  return deferred.promise;
}

module.exports = function() {
  
  var rapdbPromise = getRapDB();
  
  return through2.obj(function (gene, enc, done) {
    var that = this;

    if(!_.isObject(gene)) {
      throw new Error('gene is lacking needed info');
    }
  
    rapdbPromise.then(function(lut) {
      if (lut[gene._id]) {
        if (gene.name === gene._id && lut[gene._id].name) {
          gene.name = lut[gene._id].name;
        }
        if (lut[gene._id].synonyms) {
          gene.synonyms = lut[gene._id].synonyms
        }
        if (lut[gene._id].refs) {
          lut[gene._id].refs.forEach(ref => {
            gene.xrefs.push({
              db: 'PUBMED',
              source: 'rap-db',
              text: ref.title,
              ids: [ref.id]
            })
          })
        }
        ontologies.forEach(o => {
          const terms = Object.keys(lut[gene._id][o]);
          if (terms && terms.length > 0) {
            gene.xrefs.push({
              db: o.toUpperCase(),
              ids: terms.map(t => [t,"IDK"])
            })
            // console.error('rapdb',gene.xrefs);
          }
        })
      }
      that.push(gene);
      done();
    });
  });
}


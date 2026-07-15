#!/usr/bin/env node
var Q = require('q');
var through2 = require('through2');
var _ = require('lodash');

const ontologies = ['po','to'];
function getCurated() {
  var deferred = Q.defer();
  var url = 'https://dev.gramene.org/cshl_curated_genes.json'
  console.error('curated get('+url+')');
  // Guard the fetch with a timeout so a hung/unreachable host can't stall the
  // whole decorate pipeline forever (this stream sits in the gene hot path).
  var ctrl = new AbortController();
  var timer = setTimeout(() => ctrl.abort(), 60000);
  fetch(url, {signal: ctrl.signal})
  .then(res => { clearTimeout(timer); if(!res.ok) throw new Error('HTTP '+res.status); return res.json(); })
  .catch(err => { clearTimeout(timer); console.error('curated fetch failed ('+err.message+') — proceeding with empty curated LUT'); return []; })
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
            title: ref.description
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
    console.error('curated lookup table');
    deferred.resolve(lut);
  });

  return deferred.promise;
}

module.exports = function() {
  
  var curatedPromise = getCurated();
  
  return through2.obj(function (gene, enc, done) {
    var that = this;

    if(!_.isObject(gene)) {
      throw new Error('gene is lacking needed info');
    }
  
    curatedPromise.then(function(lut) {
      if (lut[gene._id]) {
        if (gene.name === gene._id && lut[gene._id].name) {
          gene.name = lut[gene._id].name;
        }
        if (lut[gene._id].synonyms && lut[gene._id].synonyms.length) {
          // MERGE, don't replace: preserve synonyms added upstream (e.g. fix_sorghum_v2's Sb.../Sobic.
          // JGI ids). A single-symbol curated gene (e.g. msd2) yields synonyms=[] (empty but truthy),
          // so the old `gene.synonyms = ...` replace silently wiped those upstream synonyms.
          gene.synonyms = _.uniq((gene.synonyms || []).concat(lut[gene._id].synonyms));
        }
        if (lut[gene._id].refs) {
          lut[gene._id].refs.forEach(ref => {
            gene.xrefs.push({
              db: 'PUBMED',
              source: 'CSHL',
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


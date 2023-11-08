#!/usr/bin/env node

var http = require('http')
  , fs = require('fs')
  , exec = require('child_process').exec
  , collections = require('gramene-mongodb-config')
  , argv = require('minimist')(process.argv.slice(2));

var ontologies = [
  {
    collectionName: 'GO',
    obo: 'http://purl.obolibrary.org/obo/go.obo',
    prefix: 'GO'
  },
  {
    collectionName: 'PO',
    obo: 'http://purl.obolibrary.org/obo/po.obo',
    prefix: 'PO'
  },
  // {
  //   collectionName: 'taxonomy',
  //   obo: 'http://purl.obolibrary.org/obo/ncbitaxon.obo',
  //   prefix: 'NCBITaxon'
  // },
  // {
  //   collectionName: 'SO',
  //   obo: 'http://sourceforge.net/p/song/svn/HEAD/tree/trunk/so-xp-simple.obo?format=raw',
  //   prefix: 'SO'
  // },
  {
    collectionName: 'TO',
    obo: 'http://purl.obolibrary.org/obo/to.obo',
    prefix: 'TO'
  },
  // {
  //   collectionName: 'GRO',
  //   obo: 'http://palea.cgrb.oregonstate.edu/viewsvn/Poc/trunk/ontology/collaborators_ontology/gramene/temporal_gramene.obo',
  //   prefix: 'GRO'
  // },
  // {
  //   collectionName: 'EO',
  //   obo: 'http://www.berkeleybop.org/ontologies/eo.obo',
  //   prefix: 'EO'
  // }
];

var outDir = argv.t;
var mongoConfig =  collections.getMongoConfig();
collections.closeMongoDatabase();
ontologies.forEach(function(ontology) {
  var oboFile = outDir+'/'+ontology.collectionName+'.obo'
  var curl = 'curl -L '+ontology.obo+' -o '+oboFile;
  console.error(curl);
  exec(curl, function(err, stdout, stderr) {
    if (err) throw err;
    console.error('downloaded',oboFile);
    var parse = './obo2json.pl '+ontology.prefix+' '+outDir+' < '+oboFile;
    console.error(parse);
    exec(parse, function(err, stdout, stderr) {
      if (err) throw err;
      var docs = outDir + '/' + ontology.prefix + '.Term.json';
      console.error('parsed',docs);
      var filter = 'cat '+docs;
      // if (ontology.collectionName === 'taxonomy') {
      //   filter = argv.foster ? `./filter_taxonomy2.js -f ${argv.foster}` : './filter_taxonomy.js';
      //   if (argv.synonym) {
      //     filter += ` --synonym ${argv.synonym}`
      //   }
      //   filter += ' --taxonomy ' + docs;
      //   if (argv.pan) {
      //     filter += ' --pan ' + argv.pan;
      //   }
      // }
      var mongoimport = 'mongoimport'
      + ' --host ' + mongoConfig.host
      + ' --db ' + mongoConfig.db
      + ' --port ' + mongoConfig.port
      + ' --collection ' + ontology.collectionName
      + ' --drop';
      var load = filter + ' | ' + mongoimport;
      console.error(load);
      exec(load, function(err, stdout, stderr) {
        if (err) throw err;
        console.error('loaded',ontology.collectionName);
      })
    });
  });
});

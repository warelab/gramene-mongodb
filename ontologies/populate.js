#!/usr/bin/env node

var http = require('http'),
    fs   = require('fs'),
    exec = require('child_process').exec;
    
var collections = require('gramene-mongodb-config');


var ontologies = [
  {
    collectionName: 'GO',
    obo: 'http://www.berkeleybop.org/ontologies/go.obo',
    prefix: 'GO'
  },
  {
    collectionName: 'PO',
    obo: 'http://www.berkeleybop.org/ontologies/po.obo',
    prefix: 'PO'
  },
  {
    collectionName: 'taxonomy',
    obo: 'http://www.berkeleybop.org/ontologies/ncbitaxon.obo',
    prefix: 'NCBITaxon'
  },
  {
    collectionName: 'SO',
    obo: 'http://sourceforge.net/p/song/svn/HEAD/tree/trunk/so-xp-simple.obo?format=raw',
    prefix: 'SO'
  },
  {
    collectionName: 'TO',
    obo: 'http://www.berkeleybop.org/ontologies/to.obo',
    prefix: 'TO'
  },
  // {
  //   collectionName: 'GRO',
  //   obo: 'http://palea.cgrb.oregonstate.edu/viewsvn/Poc/trunk/ontology/collaborators_ontology/gramene/temporal_gramene.obo',
  //   prefix: 'GRO'
  // },
  {
    collectionName: 'EO',
    obo: 'http://www.berkeleybop.org/ontologies/eo.obo',
    prefix: 'EO'
  }
];

var outDir = process.argv[2];
var mongoConfig = collections.getMongoConfig();
function parseLoad(ontology) {
  var cmd = './obo2json.pl '+ontology.prefix+' '+outDir+' < '+outDir+'/'+ontology.collectionName+'.obo';
  console.log(cmd);
  var parse = exec(cmd, function (error, stdout, stderr) {
    if (error !== null) {
      console.log('error running [' + cmd + '] ' + error);
    }
    else {
      console.log('parsed '+ontology.collectionName+'.obo');
      // NCBI taxonomy is too large, prune branches that don't lead to any of the species we care about
      if (ontology.collectionName === 'taxonomy') {
        cmd = './filter_taxonomy.js '+outDir+'/'+ontology.prefix+'.Term.json';
      }
      else {
        cmd = 'cat '+outDir+'/'+ontology.prefix+'.Term.json';
      }
      cmd += ' | mongoimport --host ' + mongoConfig.host
      + ' --db ' + mongoConfig.db
      + ' --port ' + mongoConfig.port
      + ' --drop --collection ' + ontology.collectionName;
      console.log(cmd);
      var load = exec(cmd, function (error, stdout, stderr) {
        if (error !== null) {
          console.log('error running [' + cmd + '] ' + error);
        }
        else {
          console.log('imported '+outDir+'/'+ontology.collectionName+'.Term.json to mongodb');
        }
      });
    }
  });
}

function downloadParseLoad(ontology) {
    console.log(ontology.obo);
    http.get(ontology.obo, function(res) {
        var obo = '';
        res.on('data',function (chunk) {
            obo += chunk;
        });
        res.on('end', function (err) {
            fs.writeFile(outDir + '/' + ontology.collectionName + '.obo', obo, function (err) {
                if (err) throw err;
                console.log('downloaded ' + ontology.collectionName + '.obo');
                parseLoad(ontology);
            });
        });
    }).on('error', function(e) {
        console.log("Got error: " + e.message);
    });
    
}

ontologies.forEach(function(ontology) {
  downloadParseLoad(ontology);
});

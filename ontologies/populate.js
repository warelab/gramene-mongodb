#!/usr/bin/env node

var http = require('http'),
    fs   = require('fs'),
    exec = require('child_process').exec;
    
var argv = require('minimist')(process.argv.slice(2));


var ontologies = {
    // 'EO'        : 'http://palea.cgrb.oregonstate.edu/viewsvn/Poc/trunk/ontology/collaborators_ontology/plant_environment/environment_ontology.obo',
    'GO'        : 'http://geneontology.org/ontology/go.obo',
    // 'GRO'       : 'http://palea.cgrb.oregonstate.edu/viewsvn/Poc/trunk/ontology/collaborators_ontology/gramene/temporal_gramene.obo',
    // 'GR_tax'    : 'http://palea.cgrb.oregonstate.edu/viewsvn/Poc/trunk/ontology/collaborators_ontology/gramene/taxonomy/GR_tax-ontology.obo',
    'taxonomy' : 'http://www.berkeleybop.org/ontologies/ncbitaxon.obo',
    'PO'        : 'http://palea.cgrb.oregonstate.edu/viewsvn/Poc/tags/live/plant_ontology.obo',
    // 'SO'        : 'http://sourceforge.net/p/song/svn/HEAD/tree/trunk/so-xp-simple.obo?format=raw',
    // 'TO'        : 'http://palea.cgrb.oregonstate.edu/viewsvn/Poc/trunk/ontology/collaborators_ontology/gramene/traits/trait.obo',
};

var outDir = argv.o;
var database = argv.d;
var host = argv.h;

function parseLoad(o) {
    var cmd = './obo2json.pl '+o+' '+outDir+' < '+outDir+'/'+o+'.obo';
    console.log(cmd);
    var parse = exec(cmd, function (error, stdout, stderr) {
        if (error !== null) {
            console.log('error running [' + cmd + '] ' + error);
        }
        else {
            console.log('parsed '+o+'.obo');
            cmd = 'mongoimport --host '+host+' --db '+database+' --drop --collection ' + o + ' < '+outDir+'/' + o+'.Term.json';
            console.log(cmd);
            var load = exec(cmd, function (error, stdout, stderr) {
                if (error !== null) {
                    console.log('error running [' + cmd + '] ' + error);
                }
                else {
                    console.log('imported '+outDir+'/'+o+'.Term.json to mongodb');
                }
            });
        }
    });
}

function downloadParseLoad(o,url) {
    console.log(o,url);
    http.get(url, function(res) {
        var obo = '';
        res.on('data',function (chunk) {
            obo += chunk;
        });
        res.on('end', function (err) {
            fs.writeFile(outDir + '/' + o + '.obo', obo, function (err) {
                if (err) throw err;
                console.log('downloaded ' + o + '.obo');
                parseLoad(o);
            });
        });
    }).on('error', function(e) {
        console.log("Got error: " + e.message);
    });
    
}

for (var o in ontologies) {
    downloadParseLoad(o,ontologies[o]);
}

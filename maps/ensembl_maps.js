#!/usr/bin/env node

var http = require('http');
// this script uses the ensembl rest api to fetch the hosted species
// and assembly info. 

// the list of species:
// http://$ENSEMBL_REST/info/species?content-type=application/json
// the list of top level sequences in the assembly:
// http://$ENSEMBL_REST/info/assembly/$species?content-type=application/json

var rest_api = process.argv[2];
var output = process.argv[3];

function fetchAssembly(species) {
    http.get(rest_api + '/info/assembly/'+species+'?content-type=application/json', function(res) {
        var assemblyJSON = '';
        res.on('data', function (chunk) {
            assemblyJSON += chunk;
        });
        res.on('end', function (err) {
            var assemblyObj = JSON.parse(assemblyJSON);
            for (var j in assemblyObj.top_level_region) {
                var sr = assemblyObj.top_level_region[j];
                sr.mapSet = species;
                console.log(JSON.stringify(sr));
            }
        });
    }).on('error', function(e) {
        console.log("Got error: " + e.message);
    });
}


http.get(rest_api + '/info/species?content-type=application/json', function(res) {
    var speciesJSON = '';
    res.on('data',function (chunk) {
        speciesJSON += chunk;
    });
    res.on('end', function (err) {
        var obj = JSON.parse(speciesJSON);
        for (var i in obj.species) {
            var species = obj.species[i];
            species.taxon_id = +species.taxon_id;
            if (output === 'species') {
                console.log(JSON.stringify(species));
            }
            else {
                fetchAssembly(species.name);
            }
        }
    });
}).on('error', function(e) {
    console.log("Got error: " + e.message);
});

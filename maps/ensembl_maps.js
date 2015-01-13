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

function fetchAssembly(system_name,taxon,assembly) {
  http.get(rest_api + '/info/assembly/'+system_name+'?content-type=application/json', function(res) {
    var assemblyJSON = '';
    res.on('data', function (chunk) {
      assemblyJSON += chunk;
    });
    res.on('end', function (err) {
      var assemblyObj = JSON.parse(assemblyJSON);
      var map = {
        _id : assembly,
        taxon_id : taxon,
        system_name : system_name,
        type : "genome",
        length : 0
      };
      // if (assemblyObj.assembly_accession === assembly) {
        map.regions = {};
        map.regions.names = assemblyObj.karyotype;
        map.regions.lengths = [];
        var rlen = {};
        map.regions.names.forEach(function(r) {
          rlen[r] = 0;
        });
        for (var j in assemblyObj.top_level_region) {
          var sr = assemblyObj.top_level_region[j];
          if (!rlen.hasOwnProperty(sr.name)) {
            if (rlen.hasOwnProperty("UNANCHORED")) rlen.UNANCHORED += sr.length;
            else rlen.UNANCHORED = sr.length;
          }
          rlen[sr.name] = sr.length;
          map.length += sr.length;
        }
        if (rlen.hasOwnProperty("UNANCHORED")) {
          map.regions.names.push("UNANCHORED");
        }
        map.regions.names.forEach(function(name) {
          map.regions.lengths.push(rlen[name]);
        });
        console.log(JSON.stringify(map));
      // }
      // else {
      //   console.log("ERROR matching assembly_name to assembly "+system_name+" -- "+assembly);
      // }
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
            if (!species.accession) species.accession = species.assembly;
            if (output === 'species') {
                console.log(JSON.stringify(species));
            }
            else {
                fetchAssembly(species.name,species.taxon_id,species.accession);
            }
        }
    });
}).on('error', function(e) {
    console.log("Got error: " + e.message);
});

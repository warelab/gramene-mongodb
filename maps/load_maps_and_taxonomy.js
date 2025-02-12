#!/usr/bin/env node
// connect to mysql database
var mysql = require('mysql');
var cores = require('../ensembl_db_info.json').cores;
var compara = require('../ensembl_db_info.json').compara;
var collections = require('gramene-mongodb-config');
var Q = require('q');
var _ = require('lodash');

var left_index = {};
var taxon_tally = {};
var taxon_offset = {};
var promises = cores.map(function(core) {
  return get_maps(core);
});

var mongoMapsPromise = collections.maps.mongoCollection();
var mongoTaxPromise = collections.taxonomy.mongoCollection();

var mapsPromise = Q.all(promises).then(function(maps) {
  return _.flatten(maps);
});
mapsPromise.then(function(maps) {
  var comparaConn = mysql.createConnection(compara);
  if (!comparaConn) throw "error connecting to compara";
  comparaConn.connect();
  let taxa = [...new Set(maps.map(m => m.taxon_id))];
  const comparaGenomesSQL = `SELECT name from genome_db where taxon_id IN (${taxa.join(',')})`;
  comparaConn.query(comparaGenomesSQL, function(err, rows, fields) {
    if (err) throw err;
    let inCompara = {};
    rows.forEach(r => {
      inCompara[r.name] = 1;
    });
    const taxTreeSQL = `SELECT taxon_id,left_index,right_index from ncbi_taxa_node where taxon_id IN (${taxa.join(',')})`;
    comparaConn.query(taxTreeSQL, function (err, rows, fields) {
      if (err) throw err;
      const clauses = rows.map(r => `(left_index <= ${r.left_index} and right_index >= ${r.right_index})`);
      const nodesSQL = `SELECT * FROM ncbi_taxa_node where ${clauses.join(' OR ')}`;
      comparaConn.query(nodesSQL, function (err, rows, fields) {
        if (err) throw err;
        let nodes = rows.map(r => {
          left_index[r.taxon_id] = r.left_index;
          return {
            _id: r.taxon_id,
            is_a: [r.parent_id],
            rank: r.rank,
            namespace: "ncbi_taxonomy",
            id: `NCBITaxon:${r.taxon_id}`,
            num_genes: 0,
            synonym: [],
            subset: ["gramene"]
          }
        });
        taxa = nodes.map(n => n._id);
        const nodeIdx = _.keyBy(nodes, '_id');
        nodeIdx[1].is_a = [];
        const namesSQL = `SELECT * FROM ncbi_taxa_name where taxon_id IN (${taxa.join(',')})`;
        comparaConn.query(namesSQL, function (err, names, fields) {
          if (err) throw err;
          names.forEach(n => {
            let node = nodeIdx[n.taxon_id];
            if (n.name_class === "scientific name") {
              node.name = n.name;
            } else if (n.name_class === "synonym" || n.name_class === "common name" || n.name_class === "genbank common name") {
              node.synonym.push(n.name)
            }
          });
          comparaConn.end();

          // TODO: insert into maps and taxonomy collections
          mongoMapsPromise.then(function(mapsCollection) {
            mapsCollection.deleteMany({}, function(err) {
              if (err) {
                throw err;
              }
              var insertThese = maps.map(function(map) {
                const taxNode = nodeIdx[map.taxon_id];
                taxon_offset[map.taxon_id]++;
                map.left_index = left_index[map.taxon_id] + 0.001 * taxon_offset[map.taxon_id];
                map.anchor_taxon_id = map.taxon_id;
                map.taxon_id = map.taxon_id * 1000 + taxon_offset[map.taxon_id];
                let childNode = Object.assign({},taxNode);
                childNode.is_a = [childNode._id];
                childNode._id = map.taxon_id;
                childNode.id = `NCBITaxon:${map.taxon_id}`,
                childNode.rank = "genome";
                childNode.left_index = map.left_index;
                childNode.name = map.display_name;
                childNode.synonym = [];
                // clean up
                delete childNode.ancestors;
                childNode.num_genes = 0;
                childNode.subset = ["gramene"];
                nodes.push(childNode);
                function populate_ancestors(node,nGenes,compara) {
                  if (!node.ancestors) {
                    node.ancestors = [node._id];
                  }
                  node.num_genes += nGenes;
                  if (compara && node.subset.length === 1) {
                    node.subset.push("compara");
                  }
                  if (node._id === 1) {
                    return node.ancestors;
                  }
                  else {
                    node.is_a.forEach(pid => {
                      const pNode = nodeIdx[pid];
                      const pAncestors = populate_ancestors(pNode,nGenes,compara);
                      pAncestors.forEach(id => node.ancestors.push(id));
                    });
                    node.ancestors = [...new Set(node.ancestors)];
                    return node.ancestors;
                  }
                }
                let ancestors = populate_ancestors(childNode,map.num_genes,inCompara[map.system_name]);
                return map;
              });
              mapsCollection.insertMany(insertThese, function(err, result) {
                if (err) {
                  throw err;
                }
                console.error("finished loading maps");
                mongoTaxPromise.then(function(taxCollection) {
                  taxCollection.deleteMany({}, function(err) {
                    if (err) {
                      throw err;
                    }
                    let filtered = nodes.filter(n => n.ancestors);
                    taxCollection.insertMany(filtered, function(err, result) {
                      if (err) {
                        throw err;
                      }
                      collections.closeMongoDatabase();
                      console.error("finished loading taxonomy");
                    });
                  });
                });
              });
            })
          });
        });
      });
    });
  });
});
  // });
  // var comparaSQL = `SELECT g.genome_db_id,g.name,g.strain_name,g.display_name,stn.taxon_id,stn.left_index from species_tree_node stn, genome_db g where g.genome_db_id = stn.genome_db_id and stn.root_id = ${species_tree_root_id}`;
  // console.error(`running query: ${comparaSQL}`);
  // comparaConn.query(comparaSQL, function (err, rows, fields) {
  // // comparaConn.query('select taxon_id,left_index from species_tree_node where genome_db_id IS NOT NULL', function (err, rows, fields) {
  //   if (err) throw err;
  //   rows.forEach(function(r) {
  //     var map = coreLUT[r.name];
  //     if (map) {
  //       map.left_index = r.left_index;
  //       map.genome_db_id = r.genome_db_id;
  //       map.strain_name = r.strain_name;
  //       if (!left_index[r.taxon_id] || left_index[r.taxon_id] > r.left_index) {
  //         left_index[r.taxon_id] = r.left_index;
  //       }
  //     }
  //     else {
  //       console.error(`no map for genome_db_id: ${r.genome_db_id}`);
  //     }
  //   });
  //   comparaConn.end();
//     mongoMapsPromise.then(function(mapsCollection) {
//       var insertThese = maps.map(function(map) {
//         if (map.genome_db_id) {
//           return map;
//         }
//         if (!left_index.hasOwnProperty(map.taxon_id)) {
//           console.error(`no left_index for ${map.taxon_id}`);
//         }
//         taxon_offset[map.taxon_id]++;
//         map.left_index = left_index[map.taxon_id] + 0.001 * taxon_offset[map.taxon_id];
//         return map;
//       });
//       mapsCollection.insertMany(insertThese, function(err, result) {
//         if (err) {
//           throw err;
//         }
//         console.error("finished loading maps");
//         collections.closeMongoDatabase();
//       });
//     });
//   });
// });
//

function get_maps(dbInfo) {
  var deferred = Q.defer();
  var core = mysql.createConnection(dbInfo);
  if (!core) throw "error";
  core.connect();
  console.error(`get_maps(${dbInfo.database})`);
  core.query('select species_id,meta_key,meta_value from meta', function(err, rows, fields) {
    if (err) throw err;
    // do something with the metadata
    var meta = {};
    rows.forEach(function(r) {
      if (! meta.hasOwnProperty(r.species_id)) {
        meta[r.species_id] = {};
      }
      meta[r.species_id][r.meta_key] = r.meta_value;
    });
    var running = 0;
    var deezmaps = [];
    Object.keys(meta).forEach(function(species_id) {
      running++;
      var map = {
        db: dbInfo.database,
        _id: meta[species_id].hasOwnProperty('assembly.accession') ? meta[species_id]['assembly.accession'] : meta[species_id]['assembly.name'],
        taxon_id: +meta[species_id]['species.taxonomy_id'],
        system_name: meta[species_id]['species.production_name'],
        display_name: meta[species_id]['species.display_name'],
        type: 'genome',
        is_anchor: !!dbInfo.anchor,
        length: 0,
        regions: {
          names: [],
          lengths: []
        }
      }
      if (map._id === "") {
        console.log("failed to find id for assembly", map);
      }
      if (!taxon_tally.hasOwnProperty(map.taxon_id)) {
        taxon_tally[map.taxon_id] = 0;
        taxon_offset[map.taxon_id]=0;
      }
      taxon_tally[map.taxon_id]++;
      core.query('SELECT sr.seq_region_id, sr.name, sr.length, sr.coord_system_id, sra.value '
      + 'FROM seq_region sr, seq_region_attrib sra, attrib_type at, coord_system cs '
      + 'WHERE at.code = "karyotype_rank" '
      + 'AND at.attrib_type_id = sra.attrib_type_id '
      + 'AND sra.seq_region_id = sr.seq_region_id '
      + 'AND sr.coord_system_id = cs.coord_system_id '
      + 'AND cs.species_id = ' + species_id, function(err, rows, fields) {
        if (err) throw err;
        rows.forEach(function(r) {
          r.value = +r.value;
        });
        rows.sort(function(a,b) {
          if (a.value > b.value) {
             return 1;
           }
           if (a.value < b.value) {
             return -1;
           }
           // a must be equal to b
           return 0;
        });
        rows.forEach(function(r) {
          map.regions.names.push(r.name);
          map.regions.lengths.push(r.length);
          map.length += r.length;
        });
        core.query('SELECT SUM(sr.length) as sum '
        + 'FROM seq_region sr, seq_region_attrib sra, attrib_type at, coord_system cs '
        + 'WHERE at.code = "toplevel"  '
        + 'AND at.attrib_type_id = sra.attrib_type_id '
        + 'AND sra.seq_region_id = sr.seq_region_id '
        + 'AND sr.coord_system_id = cs.coord_system_id  '
        + 'AND cs.species_id = '+species_id, function(err, rows, fields) {
          if (err) throw err;
          var unanchored = rows[0].sum - map.length;
          if (!!unanchored) {
            map.regions.names.push('UNANCHORED');
            map.regions.lengths.push(unanchored);
          }
          core.query('SELECT COUNT(*) as num_genes '
          + 'FROM gene g, seq_region sr, coord_system cs '
          + 'WHERE g.is_current=1 '
          + 'AND g.seq_region_id = sr.seq_region_id '
          + 'AND sr.coord_system_id = cs.coord_system_id '
          + 'AND cs.species_id = '+species_id, function(err, rows, fields) {
            if (err) throw err;
            map.num_genes = rows[0].num_genes;
            if (map.num_genes && map.taxon_id) {
              deezmaps.push(map);
            }
            running--;
          });
        });
      });
    });
    function poll() {
      if (running) {
        setTimeout(poll, 5000)
      }
      else {
        core.end();
        deferred.resolve(deezmaps);
      }
    }
    poll();
  });
  return deferred.promise;
}

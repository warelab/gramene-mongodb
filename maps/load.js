#!/usr/bin/env node
// connect to mysql database
var mysql = require('mysql2/promise');
var cores = require('../ensembl_db_info.json').cores;
var compara = require('../ensembl_db_info.json').compara;
var collections = require('gramene-mongodb-config');
var _ = require('lodash');

async function getTaxonomy(dbInfo,maps) {
  const db = await mysql.createConnection(dbInfo);
  try {
    const taxa = [...new Set(maps.map(m => m.taxon_id))];

    // Which genomes took part in the compara analysis, keyed by production name — the same key
    // as maps.system_name, which is how the result is looked up.
    //
    // This used to select genome_db WHERE taxon_id IN (our maps' taxon ids). That silently
    // under-reports whenever compara does not key its genomes by the real NCBI taxon: compara 11
    // assigns synthetic per-genome taxa to the sorghum accessions (sorghum_pi536008 -> 45580011)
    // while maps still hold the real 4558, so the only rows that matched were the handful of
    // outgroups carrying a genuine NCBI taxon — 9 of 79 genomes. Names are the stable join here,
    // and they match exactly, so ask genome_db directly instead of going through taxon ids.
    // genome_component IS NULL skips the per-component rows of polyploid genomes, which repeat
    // the same name.
    const [genomeRows] = await db.query(`SELECT name FROM genome_db WHERE genome_component IS NULL`);
    let inCompara = {};
    genomeRows.forEach(r => {
      inCompara[r.name] = 1;
    });
    const nMatched = maps.filter(m => inCompara[m.system_name]).length;
    console.error(`compara genomes: ${genomeRows.length}; of this build's ${maps.length} genomes, ${nMatched} are in compara`);

    const [taxTreeRows] = await db.query(`SELECT taxon_id,left_index,right_index from ncbi_taxa_node where taxon_id IN (${taxa.join(',')})`);
    const clauses = taxTreeRows.map(r => `(left_index <= ${r.left_index} and right_index >= ${r.right_index})`);

    const [taxNodeRows] = await db.query(`SELECT * FROM ncbi_taxa_node where ${clauses.join(' OR ')}`);

    var left_index = {};
    const nodes = taxNodeRows.map(r => {
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
    const comparaTaxa = nodes.map(n => n._id);
    const nodeIdx = _.keyBy(nodes, '_id');
    nodeIdx[1].is_a = [];
    const [taxNameRows] = await db.query(`SELECT * FROM ncbi_taxa_name where taxon_id IN (${comparaTaxa.join(',')})`);
    taxNameRows.forEach(n => {
      let node = nodeIdx[n.taxon_id];
      if (n.name_class === "scientific name") {
        node.name = n.name;
      } else if (n.name_class === "synonym" || n.name_class === "common name" || n.name_class === "genbank common name") {
        node.synonym.push(n.name)
      }
    });
    return {nodes:nodes, nodeIdx:nodeIdx, left_index:left_index, inCompara:inCompara};
  } catch (error) {
    console.error(`Error in getCompara(${dbInfo.database}):`, error);
    throw error;
  } finally {
    db.end()
  }
}

async function getMaps(dbInfo) {
  const core = await mysql.createConnection(dbInfo);
  try {
    const [metaRows] = await core.query(
      'SELECT species_id, meta_key, meta_value FROM meta WHERE species_id IS NOT NULL'
    );

    const meta = metaRows.reduce((acc, row) => {
      if (!acc[row.species_id]) acc[row.species_id] = {};
      acc[row.species_id][row.meta_key] = row.meta_value;
      return acc;
    }, {});

    const maps = [];
    for (const species_id of Object.keys(meta)) {
      const map = {
        db: dbInfo.database,
        _id: meta[species_id]['assembly.accession'] || meta[species_id]['assembly.name'],
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
      };

      const [regionRows] = await core.query(
        'SELECT sr.seq_region_id, sr.name, sr.length, sr.coord_system_id, sra.value ' +
        'FROM seq_region sr ' +
        'JOIN seq_region_attrib sra ON sr.seq_region_id = sra.seq_region_id ' +
        'JOIN attrib_type at ON sra.attrib_type_id = at.attrib_type_id ' +
        'JOIN coord_system cs ON sr.coord_system_id = cs.coord_system_id ' +
        'WHERE at.code = "karyotype_rank" AND cs.species_id = ?', [species_id]
      );

      regionRows.sort((a, b) => a.value - b.value);
      regionRows.forEach(r => {
        map.regions.names.push(r.name);
        map.regions.lengths.push(r.length);
        map.length += r.length;
      });

      const [[{ sum }]] = await core.query(
        'SELECT SUM(sr.length) as sum ' +
        'FROM seq_region sr ' +
        'JOIN seq_region_attrib sra ON sr.seq_region_id = sra.seq_region_id ' +
        'JOIN attrib_type at ON sra.attrib_type_id = at.attrib_type_id ' +
        'JOIN coord_system cs ON sr.coord_system_id = cs.coord_system_id ' +
        'WHERE at.code = "toplevel" AND cs.species_id = ?', [species_id]
      );

      const unanchored = sum - map.length;
      if (unanchored) {
        map.regions.names.push('UNANCHORED');
        map.regions.lengths.push(unanchored);
      }

      const [[{ num_genes }]] = await core.query(
        'SELECT COUNT(*) as num_genes ' +
        'FROM gene g ' +
        'JOIN seq_region sr ON g.seq_region_id = sr.seq_region_id ' +
        'JOIN coord_system cs ON sr.coord_system_id = cs.coord_system_id ' +
        'WHERE g.is_current = 1 AND cs.species_id = ?', [species_id]
      );

      map.num_genes = num_genes || 0;
      if (map.num_genes && map.taxon_id) {
        maps.push(map);
      }
    }
    core.end();
    return maps;
  } catch (error) {
    console.error(`Error in getMaps(${dbInfo.database}):`, error);
    throw error;
  } finally {
    core.end()
  }
}

async function asyncPool(limit, array, iteratorFn) {
  const ret = [];
  const executing = [];

  for (const item of array) {
    const p = Promise.resolve().then(() => iteratorFn(item));
    ret.push(p);

    if (limit <= array.length) {
      const e = p.then(() => executing.splice(executing.indexOf(e), 1));
      executing.push(e);
      if (executing.length >= limit) {
        await Promise.race(executing);
      }
    }
  }

  return Promise.all(ret);
}

function updateMaps(maps, taxonomy) {
  let taxon_offset = {};
  maps.forEach(map => taxon_offset[map.taxon_id] = 0);
  return maps.map(map => {
    const taxNode = taxonomy.nodeIdx[map.taxon_id];
    if (!taxNode) {
      console.error("taxonomy.nodeIdx[map.taxon_id] is null",map)
    }
    taxon_offset[map.taxon_id]++;
    map.left_index = taxonomy.left_index[map.taxon_id] + 0.001 * taxon_offset[map.taxon_id];
    map.anchor_taxon_id = map.taxon_id;
    // in_compara: true for genomes that were in the gene-tree (compara) analysis.
    // taxonomy.inCompara is keyed by production name from the compara genome_db table
    // (see getTaxonomy); the same flag drives the taxonomy "compara" subset below.
    map.in_compara = !!taxonomy.inCompara[map.system_name];
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
    taxonomy.nodes.push(childNode);
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
          const pNode = taxonomy.nodeIdx[pid];
          const pAncestors = populate_ancestors(pNode,nGenes,compara);
          pAncestors.forEach(id => node.ancestors.push(id));
        });
        node.ancestors = [...new Set(node.ancestors)];
        return node.ancestors;
      }
    }
    let ancestors = populate_ancestors(childNode,map.num_genes,taxonomy.inCompara[map.system_name]);
    return map;
  })
}
async function main() {
  try {
    const allMaps = (await asyncPool(5, cores, getMaps)).flat();  // Limit to 5 concurrent getMaps calls
    // const allMaps = (await Promise.all(cores.map(getMaps))).flat();
    console.error("All maps loaded");

    const taxonomy = await getTaxonomy(compara, allMaps);
    console.error("Compara taxonomy fetched")
    
    const mongoMapsCollection = await collections.maps.mongoCollection();
    await mongoMapsCollection.deleteMany({});
    const insertThese = updateMaps(allMaps, taxonomy)
    await mongoMapsCollection.insertMany(insertThese);
    console.error("Finished loading maps");
    
    const mongoTaxCollection = await collections.taxonomy.mongoCollection();
    await mongoTaxCollection.deleteMany({});
    const filteredTaxa = taxonomy.nodes.filter(n => n.ancestors);
    await mongoTaxCollection.insertMany(filteredTaxa);
    console.error("Finished loading taxonomy");

    await collections.closeMongoDatabase();
    console.error("MongoDB connection closed");
  } catch (error) {
    console.error("Error in main:", error);
  }
}

main();

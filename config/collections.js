var host = 'brie.cshl.edu'
  , port = 27017
  , dbVersion = 46;

var collections = {
  genes : {
    host           : host,
    port           : port,
    dbName         : 'search'+dbVersion,
    collectionName : 'genes',
    description    : 'gramene genes'
  },
  genetrees : {
    host           : host,
    port           : port,
    dbName         : 'search'+dbVersion,
    collectionName : 'genetree',
    description    : 'compara gene trees'
  }, 
  GO : {
    host           : host,
    port           : port,
    dbName         : 'ontology'+dbVersion,
    collectionName : 'GO',
    description    : 'gene ontology terms'
  },
  PO : {
    host           : host,
    port           : port,
    dbName         : 'ontology'+dbVersion,
    collectionName : 'PO',
    description    : 'plant ontology terms'
  },
  taxonomy : {
    host           : host,
    port           : port,
    dbName         : 'ontology'+dbVersion,
    collectionName : 'NCBITaxon',
    description    : 'NCBI taxonomy (pruned to cover gramene species)'
  },
  domains : {
    host           : host,
    port           : port,
    dbName         : 'ontology'+dbVersion,
    collectionName : 'interpro',
    description    : 'intepro domains'
  },
  maps : {
    host           : host,
    port           : port,
    dbName         : 'search'+dbVersion,
    collectionName : 'maps',
    description    : 'maps genomes, genetic maps, and physical maps'
  }
};
module.exports = collections;

// note, the schemas here do not describe the documents completely, just used
// as a guide for validating query parameters
// and casting from string to integer when appropriate
var ontology_schema = {
  _id : {
    type : 'integer',
    description : 'integerized ontology ID, e.g., GO:0001234 -> 1234'
  },
  is_a : {
    type : 'integer',
    description : 'array of parent identifiers'
  },
  synonym : {
    type : 'string',
    description : 'array of synonyms'
  },
  namespace : {
    type: 'string',
    description: 'namespace of the term'
  },
  ancestors : {
    type : 'integer',
    description : 'array of ancestor identifiers'
  },
  def : {
    type : 'string',
    description : 'definition of term'
  },
  name : {
    type : 'string',
    description : 'name of term'
  },
  comment : {
    type : 'string',
    description : 'comment'
  },
  relationship : {
    type : 'string',
    description : 'relationships to other terms'
  },
  xref : {
    type : 'string',
    description : 'cross references'
  }
};

var gene_schema = {
  gene_id : {
    type : 'string',
    description : 'ensembl gene id'
  },
  seq_region : {
    type : 'string',
    description : "sequence name"
  },
  startPos : {
    type : 'integer',
    description : "start position of gene"
  },
  endPos : {
    type : 'integer',
    description : 'end position of gene'
  },
  system_name : {
    type : 'string',
    description : 'name within ensembl'
  },
  taxon_id : {
    type : 'integer',
    description : 'NCBI taxonomy idenifier'
  },
  name : {
    type : 'string',
    description : 'gene name'
  },
  species : {
    type : 'string',
    description : 'species name'
  },
  description : {
    type : 'string',
    description : 'gene description'
  },
  biotype : {
    type : 'string',
    description : 'biotype of gene'
  },
  genetrees : {
    type : 'string',
    description : 'array of gene tree stable identifiers'
  },
  domains : {
    type : 'string',
    description : 'array of domains'
  },
  interpro : {
    type : 'integer',
    description : 'array of interpro domain identifiers'
  },
  xrefs_db_s : {
    type : 'string',
    description : 'list of xref identifiers in db'
  },
  xrefs_db_i : {
    type : 'integer',
    description : 'list of integers'
  },
  ancestors_db : {
    type : 'integer',
    description : 'list of ancestor nodes'
  }
};

var cyc_schema = {
  taxon_id : {
    type : 'integer',
    description : 'ncbi taxonomy id'
  }
};

var fields = ['species', 'system_name', 'gene_name', 'enzyme_name', 'reaction_id', 'reaction_name', 'pathway_id', 'pathway_name'];
fields.forEach(function(field) {
  cyc_schema[field] = { type : 'string', description : field };
});

var reactome_schema = {};

fields = ['object_id', 'pathway_id', 'species_id', 'taxon_id'];
fields.forEach(function(field) {
  reactome_schema[field] = { type : 'integer', description : field };
});

fields = ['type','system_name','name','pathway','content','class'];
fields.forEach(function(field) {
  reactome_schema[field] = { type : 'string', description : field };
});

exports.collections = {
  genes : {
    host           : "brie.cshl.edu",
    port           : 27017,
    dbName         : "search",
    collectionName : "genes",
    description    : "ensembl gene data",
    properties     : gene_schema
  },
  reactions : {
    host           : "brie.cshl.edu",
    port           : 27017,
    dbName         : "search",
    collectionName : "reactome",
    description    : "reactome data",
    properties     : reactome_schema
  },
  pathways : {
    host           : "brie.cshl.edu",
    port           : 27017,
    dbName         : "search",
    collectionName : "cyc",
    description    : "cyc pathway data",
    properties     : cyc_schema
  },
  EO : {
    host           : "brie.cshl.edu",
    port           : 27017,
    dbName         : "ontology",
    collectionName : "EO",
    description    : "plant environmental ontology",
    properties     : ontology_schema
  },
  GO : {
    host           : "brie.cshl.edu",
    port           : 27017,
    dbName         : "ontology",
    collectionName : "GO",
    description    : "gene ontology",
    properties     : ontology_schema
  },
  GRO : {
    host           : "brie.cshl.edu",
    port           : 27017,
    dbName         : "ontology",
    collectionName : "GRO",
    description    : "cereal plant growth stage ontology",
    properties     : ontology_schema
  },
  taxonomy : {
    host           : "brie.cshl.edu",
    port           : 27017,
    dbName         : "ontology",
    collectionName : "NCBITaxon",
    description    : "NCBI taxonomy (pruned to cover gramene species)",
    properties     : ontology_schema
  },
  PO : {
    host           : "brie.cshl.edu",
    port           : 27017,
    dbName         : "ontology",
    collectionName : "PO",
    description    : "plant ontology",
    properties     : ontology_schema
  },
  SO : {
    host           : "brie.cshl.edu",
    port           : 27017,
    dbName         : "ontology",
    collectionName : "SO",
    description    : "sequence ontology",
    properties     : ontology_schema
  },
  TO : {
    host           : "brie.cshl.edu",
    port           : 27017,
    dbName         : "ontology",
    collectionName : "TO",
    description    : "trait ontology",
    properties     : ontology_schema
  },
  domains : {
    host           : "brie.cshl.edu",
    port           : 27017,
    dbName         : "ontology",
    collectionName : "interpro",
    description    : "intepro domains",
    properties     : ontology_schema
  },
  maps : {
    host           : "brie.cshl.edu",
    port           : 27017,
    dbName         : "cmap",
    collectionName : "map",
    description    : "a collection of maps",
    properties     : {}
  }
};
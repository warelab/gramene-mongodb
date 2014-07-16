// full text index for string search
db.genes.ensureIndex({"$**":"text"});
// indexes for ontologies (can we populate this list automatically?)
db.genes.ensureIndex({"xrefs.GO":1});
db.genes.ensureIndex({"xrefs.PO":1});
db.genes.ensureIndex({"xrefs.TO":1});
db.genes.ensureIndex({"ancestors.GO":1});
db.genes.ensureIndex({"ancestors.PO":1});
db.genes.ensureIndex({"ancestors.TO":1});
db.genes.ensureIndex({"ancestors.NCBITaxon":1});
// compound index for genomic range queries
db.genes.ensureIndex({taxon_id:1, "location.seq_region":1, "location.start":1});
// indexes useful for faceting
db.genes.ensureIndex({domains:1});
db.genes.ensureIndex({biotype:1});

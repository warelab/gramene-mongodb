// full text index for string search
db.genes.ensureIndex({"$**":"text"});
db.genetree.ensureIndex({"$**":"text"});
db.GO.ensureIndex({"$**":"text"});
db.PO.ensureIndex({"$**":"text"});
db.taxonomy.ensureIndex({"$**":"text"});
db.domains.ensureIndex({"$**":"text"});
db.pathways.ensureIndex({"$**":"text"});
db.maps.ensureIndex({"$**":"text"});
// location based index for dumping sorted genes
db.genes.ensureIndex({'species_idx':1,'db_type':1,'gene_idx':1});
// gene tree index for adding domain annotations to gene tree leaf nodes
db.genes.ensureIndex({'homology.gene_tree.id':1});
// gene tree index so we can extract trees based on the compara_db name
db.genetree.ensureIndex({'compara_db':1});

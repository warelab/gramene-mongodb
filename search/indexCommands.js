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
db.genes.ensureIndex({'taxon_id':1,'location.region':1,'location.start':1});
// gene tree index for adding domain annotations to gene tree leaf nodes
db.genes.ensureIndex({'homology.gene_tree':1});

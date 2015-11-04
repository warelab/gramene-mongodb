// full text index for string search
db.genes.ensureIndex({"$**":"text"});
db.genetree.ensureIndex({"$**":"text"});
db.GO.ensureIndex({"$**":"text"});
db.PO.ensureIndex({"$**":"text"});
db.taxonomy.ensureIndex({"$**":"text"});
db.domains.ensureIndex({"$**":"text"});
db.pathways.ensureIndex({"$**":"text"});
db.maps.ensureIndex({"$**":"text"});

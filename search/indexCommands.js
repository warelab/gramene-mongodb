// full text index for string search
db.genes.ensureIndex({"$**":"text"});

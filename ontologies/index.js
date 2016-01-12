// full text indexes for string search
// db.EO.ensureIndex({"$**":"text"});
// db.GO.ensureIndex({"$**":"text"});
// // db.GRO.ensureIndex({"$**":"text"});
// db.NCBITaxon.ensureIndex({"$**":"text"});
// db.PO.ensureIndex({"$**":"text"});
// db.SO.ensureIndex({"$**":"text"});
// db.TO.ensureIndex({"$**":"text"});
// db.interpro.ensureIndex({"$**":"text"});
// 2 level indexes to accelerate ancestor lookups
db.GO.ensureIndex({_id:1,ancestors:1});
db.PO.ensureIndex({_id:1,ancestors:1});
db.taxonomy.ensureIndex({_id:1,ancestors:1});

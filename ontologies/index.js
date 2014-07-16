// full text indexes for string search
db.EO.ensureIndex({"$**":"text"});
db.GO.ensureIndex({"$**":"text"});
db.GRO.ensureIndex({"$**":"text"});
db.NCBITaxon.ensureIndex({"$**":"text"});
db.PO.ensureIndex({"$**":"text"});
db.SO.ensureIndex({"$**":"text"});
db.TO.ensureIndex({"$**":"text"});

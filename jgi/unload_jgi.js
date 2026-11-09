// unload_jgi.js — reverse 57_jgi_expression. Removes the JGI experiments/assays and strips the
// JGI-SB-* keys from the expression documents, leaving the EBI data untouched.
//
//     mongosh "mongodb://localhost:27017/sorghum11" unload_jgi.js
//
// Safe to re-run. Does NOT rebuild expression_attributes or solr — re-run 58/60/62/65 after.
var accs = db.experiments.find({source: "JGI"}, {_id: 1}).toArray().map(function (d) { return d._id; });
if (!accs.length) { print("no JGI experiments present — nothing to unload"); quit(0); }
print("unloading: " + accs.join(", "));

var unset = {};
accs.forEach(function (a) { unset[a] = ""; });
var q = {$or: accs.map(function (a) { var o = {}; o[a] = {$exists: true}; return o; })};
var n = db.expression.countDocuments(q);
print("  expression docs carrying JGI keys: " + n);
var r = db.expression.updateMany(q, {$unset: unset});
print("  stripped from " + r.modifiedCount + " docs");

// a doc left with only _id had no EBI data to begin with; drop it rather than leave a stub
var empty = db.expression.deleteMany({$expr: {$eq: [{$size: {$objectToArray: "$$ROOT"}}, 1]}});
print("  removed " + empty.deletedCount + " now-empty expression docs");

print("  assays removed:      " + db.assays.deleteMany({experiment: {$in: accs}}).deletedCount);
print("  experiments removed: " + db.experiments.deleteMany({_id: {$in: accs}}).deletedCount);
print("done — re-run 58_expression_attributes, 60_solr_genes, 62_attr_atomic, 65_solr_suggestions");

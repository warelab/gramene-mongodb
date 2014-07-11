# Ontologies database (MongoDB)
This ontologies database holds the terms as documents. The database is intended to provide information on ontology terms and support more complex queries of annotated genes or other objects. A preorder traversal of each ontology allows one to retrieve a subgraph rooted at some query node. This is useful when searching for genes associated with a query term (or any more specific descendant term). A gene document may contain GO annotations, so this database is consulted to convert the set of GO identifiers into a set of preorder LR indexes. This approach has been replaced by storing a list of ancestor nodes in each term document. That way, a subtree query for genes annotated with GO:0016746 (transferase activity, transferring acyl groups) is db.genes.find({"ancestors.GO":16746}).
## Download obo files
```
/bin/sh download.sh
```
## Parse the ontologies into JSON
```
/bin/sh parse.sh
```
## Import JSON into MongoDB
```
/bin/sh import.sh
```
## Setup indexes
```
db.go.ensureIndex({"$**":"text"})
```
## Example queries
```
$ mongo ontology
> db.go.find({_id:16746})
> db.go.find({_ancestors:16746}).count()
> db.go.find({ $text: { $search: "H3-K9 methylation" }},{ name:1,namespace:1,score: { $meta: "textScore"}}).sort({score: {$meta: "textScore"}})
```

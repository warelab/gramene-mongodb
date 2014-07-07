# Ontologies database (MongoDB)
This ontologies database holds the terms as documents. The database is intended to provide information on ontology terms and support more complex queries of annotated genes or other objects. A preorder traversal of each ontology allows one to retrieve a subgraph rooted at some query node. This is useful when searching for genes associated with a query term (or any more specific descendant term). A gene document may contain GO annotations, so this database is consulted to convert the set of GO identifiers into a set of preorder LR indexes.
## Download obo files
```
curl http://geneontology.org/ontology/go.obo > go.obo 
curl http://palea.cgrb.oregonstate.edu/viewsvn/Poc/tags/live/plant_ontology.obo > plant_ontology.obo
curl http://palea.cgrb.oregonstate.edu/viewsvn/Poc/trunk/ontology/collaborators_ontology/gramene/traits/trait.obo > trait.obo
curl http://www.berkeleybop.org/ontologies/ncbitaxon.obo > ncbitaxon.obo
```
## Parse the ontologies into JSON
```
./obo2json.pl go go.obo
./obo2json.pl ncbitaxon ncbitaxon.obo
./obo2json.pl plant_ontology plant_ontology.obo
./obo2json.pl trait trait.obo
```
## Import JSON
```
cat *.Global.json | mongoimport --db ontologies --collection Global
mongoimport --db ontologies --collection go < go.Term.json
mongoimport --db ontologies --collection ncbitaxon < ncbitaxon.Term.json
mongoimport --db ontologies --collection plant_ontology < plant_ontology.Term.json
mongoimport --db ontologies --collection trait < trait.Term.json
```
## Setup indexes
```
$ mongo
> use ontologies
> db.go.ensureIndex( { "LR" : "2d" }, { min: 0, max: 10000000 } )
> db.ncbitaxon.ensureIndex( { "LR" : "2d" }, { min: 0, max: 10000000 } )
> db.plant_ontology.ensureIndex( { "LR" : "2d" }, { min: 0, max: 10000000 } )
> db.trait.ensureIndex( { "LR" : "2d" }, { min: 0, max: 10000000 } )
> exit
```
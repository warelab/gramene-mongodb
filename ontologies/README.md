# Ontology database
The ontology database holds terms as documents. The database is intended to provide information on ontology terms and support more complex queries of annotated genes or other objects. The is_a relationships are traversed to form a list of ancestor nodes in each term document. That way, a subtree query for genes annotated with GO:0016746 | transferase activity, transferring acyl groups is `db.genes.find({"ancestors.GO":16746})`.
## Populating the ontology database
### one liner
```
mkdir tmp; ./populate.js tmp; mongo ontology < index.js
```
### manual
#### Download obo files
```
curl http://geneontology.org/ontology/go.obo > GO.obo 
curl http://palea.cgrb.oregonstate.edu/viewsvn/Poc/trunk/ontology/collaborators_ontology/gramene/temporal_gramene.obo > GRO.obo
curl http://palea.cgrb.oregonstate.edu/viewsvn/Poc/tags/live/plant_ontology.obo > PO.obo
curl http://palea.cgrb.oregonstate.edu/viewsvn/Poc/trunk/ontology/collaborators_ontology/gramene/traits/trait.obo > TO.obo
curl http://www.berkeleybop.org/ontologies/ncbitaxon.obo > NCBITaxon.obo
curl http://sourceforge.net/p/song/svn/HEAD/tree/trunk/so-xp-simple.obo?format=raw > SO.obo
curl http://palea.cgrb.oregonstate.edu/viewsvn/Poc/trunk/ontology/collaborators_ontology/plant_environment/environment_ontology.obo > EO.obo
```
#### Parse the ontologies into JSON
```
./obo2json GO < GO.obo
./obo2json GRO < GRO.obo
./obo2json PO < PO.obo
./obo2json TO < TO.obo
./obo2json SO < SO.obo
./obo2json EO < EO.obo
./obo2json NCBITaxon < NCBITaxon.obo
```
#### Import JSON into MongoDB
```
mongoimport --db ontology --collection GO < GO.Term.json
mongoimport --db ontology --collection GRO < GRO.Term.json
mongoimport --db ontology --collection EO < EO.Term.json
mongoimport --db ontology --collection PO < PO.Term.json
mongoimport --db ontology --collection SO < SO.Term.json
mongoimport --db ontology --collection TO < TO.Term.json
mongoimport --db ontology --collection NCBITaxon < NCBITaxon.Term.json
```
#### Setup indexes
```
mongo ontology
db.GO.ensureIndex({"$**":"text"})
db.GRO.ensureIndex({"$**":"text"})
db.EO.ensureIndex({"$**":"text"})
db.PO.ensureIndex({"$**":"text"})
db.SO.ensureIndex({"$**":"text"})
db.TO.ensureIndex({"$**":"text"})
db.NCBITaxon.ensureIndex({"$**":"text"})
```
## Example queries
```
$ mongo ontology
> db.GO.find({_id:16746})
> db.GO.find({_ancestors:16746}).count()
> db.GO.find({ $text: { $search: "H3-K9 methylation" }},{ name:1,namespace:1,score: { $meta: "textScore"}}).sort({score: {$meta: "textScore"}})
```

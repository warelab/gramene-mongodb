# Ontology database
The ontology database holds terms as documents. The database is intended to provide information on ontology terms and support more complex queries of annotated genes or other objects. The is_a relationships are traversed to form a list of ancestor nodes in each term document. That way, a subtree query for genes annotated with GO:0016746 | transferase activity, transferring acyl groups is `db.genes.find({"ancestors.GO":16746})`.
## Populating the ontology database
### special case InterPro
Download files, parse, and import documents
```
mkdir tmp
curl -s ftp://ftp.ebi.ac.uk/pub/databases/interpro/ParentChildTreeFile.txt > tmp/ParentChildTreeFile.txt
curl -s ftp://ftp.ebi.ac.uk/pub/databases/interpro/interpro.xml.gz | gzip -cd | node parseInterpro.js tmp/ParentChildTreeFile.txt /dev/fd/0 | mongoimport --db ontology --collection interpro

mongo ontology
> db.interpro.ensureIndex({"$**":"text"})
> db.interpro.find({$text:{$search:"TIGR01566"}})
```
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
## Remove unused documents in the NCBITaxon
There are over 1 million terms in the NCBITaxon ontology, but Gramene only hosts a few tens of species. Once the genes collection has been populated in the search db it is possible to extract the NCBITaxon terms that are actually used and then remove any terms from the ontology db that are not in that list.
```
> db.genes.aggregate({$project: { "ancestors.NCBITaxon": 1, _id:0}}, {$unwind : "$ancestors.NCBITaxon" }, {$group: {_id:"NA", ids : { $addToSet : "$ancestors.NCBITaxon"}}}, {$project : { ids : 1, _id: 0 }})
{ "ids" : [ 4577, 3602, 29760, 91834, 4113, 147428, 4555, 147369, 147370, 3700, 3243, 3246, 3244, 3245, 4637, 3745, 3699, 721805, 147429, 38820, 3694, 3193, 4070, 3051, 39947, 4572, 4530, 3646, 40149, 4554, 3754, 4641, 40148, 4618, 4533, 2759, 65489, 147367, 4537, 4513, 4640, 403667, 4069, 214687, 171637, 91835, 3803, 4512, 78536, 3847, 3701, 3242, 163735, 1437183, 45156, 91827, 424574, 359160, 147385, 2763, 4557, 2797, 45157, 980083, 1437201, 33090, 71240, 3711, 3814, 3398, 3688, 3846, 4479, 147389, 15367, 147368, 3702, 4538, 15368, 238069, 3041, 981071, 4081, 51351, 280699, 91836, 131567, 39946, 265316, 71275, 3603, 58024, 71274, 4107, 261009, 232365, 91888, 13332, 3055, 4480, 81972, 3042, 163742, 59689, 1, 3166, 4527, 1437197, 72025, 4564, 88036, 131221, 4558, 424551, 35493, 3760, 4734, 3705, 37682, 3880, 22097, 49274, 3744, 4575, 3689, 4536, 4447, 3052, 1462606, 4565, 265318, 13333, 58023, 3877, 147380, 112509 ] }
> use ontology
> db.NCBITaxon.remove({_id: {$nin: [ 4577, 3602, 29760, 91834, 4113, 147428, 4555, 147369, 147370, 3700, 3243, 3246, 3244, 3245, 4637, 3745, 3699, 721805, 147429, 38820, 3694, 3193, 4070, 3051, 39947, 4572, 4530, 3646, 40149, 4554, 3754, 4641, 40148, 4618, 4533, 2759, 65489, 147367, 4537, 4513, 4640, 403667, 4069, 214687, 171637, 91835, 3803, 4512, 78536, 3847, 3701, 3242, 163735, 1437183, 45156, 91827, 424574, 359160, 147385, 2763, 4557, 2797, 45157, 980083, 1437201, 33090, 71240, 3711, 3814, 3398, 3688, 3846, 4479, 147389, 15367, 147368, 3702, 4538, 15368, 238069, 3041, 981071, 4081, 51351, 280699, 91836, 131567, 39946, 265316, 71275, 3603, 58024, 71274, 4107, 261009, 232365, 91888, 13332, 3055, 4480, 81972, 3042, 163742, 59689, 1, 3166, 4527, 1437197, 72025, 4564, 88036, 131221, 4558, 424551, 35493, 3760, 4734, 3705, 37682, 3880, 22097, 49274, 3744, 4575, 3689, 4536, 4447, 3052, 1462606, 4565, 265318, 13333, 58023, 3877, 147380, 112509 ]}})
> db.repairDatabase()
```
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
There are over 1 million terms in the NCBITaxon ontology, but Gramene only hosts a few tens of species. Once the maps collection has been populated in the cmap db it is possible to extract the NCBITaxon terms that are actually used and then remove any terms from the ontology db that are not in that list.
```
mongo cmap
> db.species.aggregate({$project: { "taxon_id": 1, _id:0}},{$group:{_id:"NA", ids : {$addToSet : "$taxon_id"}}})
{ "_id" : "NA", "ids" : [ 436017, 280699, 214687, 77586, 40149, 4537, 40148, 39947, 109376, 37682, 29760, 13333, 88036, 3641, 4572, 3694, 112509, 65489, 4533, 4538, 4565, 4113, 4529, 4536, 4558, 4081, 4528, 4577, 3702, 4555, 3880, 81972, 3760, 3218, 51351, 3847, 15368, 39946, 3055 ] }
> use ontology
> db.NCBITaxon.aggregate({$match: {_id:{$in:[ 436017, 280699, 214687, 77586, 40149, 4537, 40148, 39947, 109376, 37682, 29760, 13333, 88036, 3641, 4572, 3694, 112509, 65489, 4533, 4538, 4565, 4113, 4529, 4536, 4558, 4081, 4528, 4577, 3702, 4555, 3880, 81972, 3760, 3218, 51351, 3847, 15368, 39946, 3055 ]}}},{$project:{ancestors:1,_id:0}},{$unwind:"$ancestors"},{$group:{_id:"NA", ids: {$addToSet:"$ancestors"}}}, {$project:{ids:1,_id:0}})
{ "ids" : [ 1035538, 242159, 70447, 13792, 265318, 265316, 45157, 45156, 2797, 4640, 112509, 4513, 4512, 3712, 3246, 3245, 3244, 35711, 436017, 2759, 65489, 3705, 3646, 3208, 40149, 81972, 4480, 403667, 3602, 2763, 147385, 4529, 147389, 15367, 13333, 4577, 3689, 4575, 4530, 4572, 232365, 4557, 147428, 147370, 147369, 4555, 41938, 4537, 22097, 91827, 424574, 359160, 147367, 4447, 3877, 3243, 3700, 13332, 91888, 4107, 261009, 3603, 58024, 71274, 131221, 4558, 35493, 424551, 4565, 3041, 238069, 214687, 4069, 3880, 77586, 29760, 4536, 4070, 3193, 3744, 49274, 3218, 163735, 78536, 3847, 3215, 4479, 3846, 4641, 40148, 4554, 4618, 4533, 3754, 51351, 404260, 109376, 3242, 3701, 147368, 3702, 980083, 1437201, 1437197, 4527, 4637, 3745, 3398, 3814, 3711, 33090, 71240, 1437183, 214909, 171637, 91835, 3803, 147429, 38820, 3694, 4081, 981071, 91834, 3688, 3217, 3641, 3055, 721805, 3699, 3640, 4734, 3216, 3760, 72025, 4564, 3051, 39947, 114656, 37682, 147380, 59689, 163742, 3052, 15368, 4538, 3214, 1462606, 4113, 131567, 39946, 71275, 280699, 91836, 3042, 58023, 4528, 3166, 1, 88036, 3629 ] }
> db.NCBITaxon.remove({_id: {$nin:[ 1035538, 242159, 70447, 13792, 265318, 265316, 45157, 45156, 2797, 4640, 112509, 4513, 4512, 3712, 3246, 3245, 3244, 35711, 436017, 2759, 65489, 3705, 3646, 3208, 40149, 81972, 4480, 403667, 3602, 2763, 147385, 4529, 147389, 15367, 13333, 4577, 3689, 4575, 4530, 4572, 232365, 4557, 147428, 147370, 147369, 4555, 41938, 4537, 22097, 91827, 424574, 359160, 147367, 4447, 3877, 3243, 3700, 13332, 91888, 4107, 261009, 3603, 58024, 71274, 131221, 4558, 35493, 424551, 4565, 3041, 238069, 214687, 4069, 3880, 77586, 29760, 4536, 4070, 3193, 3744, 49274, 3218, 163735, 78536, 3847, 3215, 4479, 3846, 4641, 40148, 4554, 4618, 4533, 3754, 51351, 404260, 109376, 3242, 3701, 147368, 3702, 980083, 1437201, 1437197, 4527, 4637, 3745, 3398, 3814, 3711, 33090, 71240, 1437183, 214909, 171637, 91835, 3803, 147429, 38820, 3694, 4081, 981071, 91834, 3688, 3217, 3641, 3055, 721805, 3699, 3640, 4734, 3216, 3760, 72025, 4564, 3051, 39947, 114656, 37682, 147380, 59689, 163742, 3052, 15368, 4538, 3214, 1462606, 4113, 131567, 39946, 71275, 280699, 91836, 3042, 58023, 4528, 3166, 1, 88036, 3629 ]}})
> db.repairDatabase()
```

## Setting up Solr cores for each collection
The solr subdirectory contains a script that will convert a stream of JSON documents exported from mongodb into a list of JSON documents that can be imported into solr. The schema.xml and solrconfig.xml files can be used to set up the core.
#### export and convert mongodb docs for solr
```
mongoexport -d ontology -c GO | node ontology2solr.js /dev/fd/0 > GO.json
mongoexport -d ontology -c PO | node ontology2solr.js /dev/fd/0 > PO.json
mongoexport -d ontology -c NCBITaxon | node ontology2solr.js /dev/fd/0 > taxonomy.json
mongoexport -d ontology -c interpro | node ontology2solr.js /dev/fd/0 > interpro.json
```
#### import into a running solr instance
```
curl 'http://localhost:8983/solr/GO/update?commit=true' --data-binary @GO.json -H 'Content-type:application/json'
curl 'http://localhost:8983/solr/PO/update?commit=true' --data-binary @PO.json -H 'Content-type:application/json'
curl 'http://localhost:8983/solr/taxonomy/update?commit=true' --data-binary @taxonomy.json -H 'Content-type:application/json'
curl 'http://localhost:8983/solr/interpro/update?commit=true' --data-binary @interpro.json -H 'Content-type:application/json'
```
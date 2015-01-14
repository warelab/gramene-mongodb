# Search database
The search database contains collections for various types of biological object. 
## Populating the genes collection
The first step is to extract information on all the genes from the ensembl databases.
This is done with a script based on
https://github.com/EnsemblGenomes/eg-web-common/blob/master/utils/search_dump.pl 
The EnsemblGenomes team uses this to output xml formatted files for use in the ensembl
search tool. Since we are using mongodb, it is more convient to work with JSON files.
The following repository was forked from EnsemblGenomes/eg-web-common and includes
some modifications to the search_dump.pl script for output in JSON format. It may
be necessary to sync the fork with the EnsemblGenomes latest in case of db schema
changes.
```
git clone https://github.com/ajo2995/eg-web-common.git
cd eg-web-common/utils
perl ./search_dump.pl -host hostname -port 3306 -user username -pass password -dir /scratch/olson/build41/genes -format json -release 41 
```
The script takes over an hour to run, so go populate the ontology database while you wait.
Once the json files are ready, we include ancestor information of the ontology terms.
```
gzip -cd /scratch/olson/build41/Gene_* | node add_ontology_fields.js /dev/fd/0 | mongoimport --db search41 --collection genes
```
Final step is to build indexes
```
mongo search41 < indexCommands.js
```

## Creating a genetrees collection
This didn't work...
```
db.genes.aggregate(
  { $match: { "genetrees.0" : { $exists : true}}},
  { $project :
    {
      _id : 0, genetrees : 1, taxon_id : 1, ipr : "$protein_features.interpro", go : "$xrefs.GO", po : "$xrefs.PO",
      txt : { $concat : [ "$gene_id", " ", "$name", " ", "$description" ] }
    }
  },
  { $unwind : "$genetrees" },
  { $unwind : "$go" },
  { $unwind : "$po" },
  { $unwind : "$ipr" },
  { $group :
    {
      _id : "$genetrees", taxa : { $addToSet : "$taxon_id" },
      interpro : { $addToSet : "$ipr" }, go : { $addToSet : "$go" },
      po : { $addToSet : "$po" }, content : { $addToSet : "$txt" }
    }
  },
  { $out : "genetrees" }
)
```
## Populating the reactome collection
```
reactome_solr_to_json.pl plant_reactome_solr_dump_082114.tab | mongoimport --db search41 --collection reactome
```
## Populating the cyc pathways collection
```
pathways_tab_to_json.pl /path/to/pathways | mongoimport --db search41 --collection cyc
```
## Example queries
```
db.genes.find({"ancestors.GO":4321}).count()
db.genes.find({$text : {$search : "kinase"}}).count()
db.genes.aggregate({$match: {$text: {$search: "kinase"}}},{$group : {_id: "$species", count: {$sum:1}}},{$sort: {"count":-1}})
```
## exporting the genes collection for use in solr
```
cd solr
mongoexport -d search -c genes | node mongo2solr.js /dev/fd/0 > genes.json
curl 'http://localhost:8983/solr/genes/update?commit=true' --data-binary @genes.json -H 'Content-type:application/json'
```
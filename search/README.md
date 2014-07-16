# Search database
The search database contains collections for various types of biological object. 
## Populating the genes collection
The first step is to extract information on all the genes from the ensembl databases.
This is done with a script based on
https://github.com/EnsemblGenomes/eg-web-common/blob/master/utils/search_dump.pl 
The EnsemblGenomes team uses this to output xml formatted files for use in the ensembl
search tool. Since we are using mongodb, it is more convient to work with JSON files.
The following repository was forked from EnsemblGenomes/eg-web-common and includes
some modifications to the search_dump.pl script for output in JSON format.

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
## Example queries
```
db.genes.find({"ancestors.GO":4321}).count()
db.genes.find({$text : {$search : "kinase"}}).count()
db.genes.aggregate({$match: {$text: {$search: "kinase"}}},{$group : {_id: "$species", count: {$sum:1}}},{$sort: {"count":-1}})
```
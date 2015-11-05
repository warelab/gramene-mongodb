## Genes collection
###  dump genes from ensembl core and otherfeatures databases
dump_genes.js extracts the gene models, xrefs, and interpro protein annotations on the canonical translation from a core or otherfeatures database.

createDumpCommands.js interrogates the mysql server hosting ensembl databases and generates command lines for dump_genes.js.
Dump gzipped json docs from each database.
```
cd <gramene-mongodb>/search
mkdir tmp
./createDumpCommands.js -g 48 -e 82 -h host -u user -p pass | parallel
```

### populate auxiliary mongodb collections
Go populate the genetree, pathways, ontologies, and maps collections.
### load homologue lookup table
```
nohup redis-server &
dump_homologs.js -h host -u user -p pass -d ensembl_compara_plants_48_82 | redis-cli --pipe
```

### finish the gene documents
Once all that is done:
```
 gzcat tmp/*.json.gz | \
 ./merge_interpro_hits.js | \
 ./add_pathways.js <pathToAssociationsFile> | \
 ./add_bins.js | \
 ./add_genetree_taxon.js | \
 ./add_homologues.js | \
 ./add_xref_ancestors.js > genes.jsonl
```
N.B. run add_xref_ancestors.js last other scripts earlier in the pipe populate xrefs.

Load the genes docs into mongodb
```
 mongoimport --db search48 --collection genes --drop < genes.jsonl
```

Final step is to build indexes (optional)
```
mongo search48 < indexCommands.js
```
Currently, this only adds one index for free text search. Solr genes and suggestions cores are the primary ways to search for genes, but the genes documents there are slimmed down. In practice, the mongo collection is queried with unique identifiers like this:
http://data.gramene.org/genes?_id=F775_06278 
or
http://data.gramene.org/genes?idList=Traes_7BL_014267D94,ORUFI04G04670,ONIVA08G06220,BGIOSGA037893,ORGLA10G0104200,OS10G0450000,OPUNC10G10040

### Example queries
```
db.genes.find({"ancestors.GO":4321}).count()
db.genes.find({$text : {$search : "kinase"}}).count()
db.genes.aggregate({$match: {$text: {$search: "kinase"}}},{$group : {_id: "$species", count: {$sum:1}}},{$sort: {"count":-1}})
```

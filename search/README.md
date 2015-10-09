# Search database
The search database contains collections for various types of biological object.
## Populating the genes collection
The first step is to extract information on all the genes from the ensembl databases.
Previously, this was done with a script based on
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

But now, a script has been written (dump_genes.js) which is specifically to extract the gene models, xrefs, and interpro protein annotations on the canonical translation from a core or otherfeatures database.

A script runAll.js has been added that interrogates the mysql server hosting ensembl databases and generates command lines for dump_genes.js.
This example command line dumps json docs from each database.
```
./runAll.js -g 46 -e 80 -h cabot -u gramene_web -p gram3n3 | parallel
```

Start the homologue lookup table daemon:
```
cd <gramene-mongodb>/search
groovy add_homologues.groovy -D -h cabot -d ensembl_compara_plants_46_80 -u gramene_web -p gram3n3
```
This takes about 15 minutes.

Go populate the ontology and maps databases.

Once all that is done check that the files are okay and then add other fields like this:
```
 cat *_46_80_*.json | \
 ./merge_interpro_hits.js | \
 ./add_xref_ancestors.js | \
 ./add_bins.js | \
 ./add_genetree_taxon.js | \
 groovy add_homologues.groovy -C | \
 mongoimport --db search46 --collection genes --drop
```
N.B. merge_interpro_hits.js has to preceed add_xref_ancestors.js because it gathers the interpro IDs under .xrefs.domains

Final step is to build indexes (optional)
```
mongo search46 < indexCommands.js
```
Currently, this only adds one index for free text search. Solr genes and suggestions cores are the primary ways to search for genes, but the genes documents there are slimmed down. In practice, the mongo collection is queried with unique identifiers like this:
http://data.gramene.org/genes?_id=F775_06278 
or
http://data.gramene.org/genes?idList=Traes_7BL_014267D94,ORUFI04G04670,ONIVA08G06220,BGIOSGA037893,ORGLA10G0104200,OS10G0450000,OPUNC10G10040

Unless you think you'll be needing it again, kill the add_homologues daemon process now. Find the process:
```
lsof -i :5432
```

Then kill it
```
kill <pid returned by above command>
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
mongoexport -d search46 -c genes | node mongo2solr.js /dev/fd/0 > genes.json
curl 'http://localhost:8983/solr/genes/update?commit=true' --data-binary @genes.json -H 'Content-type:application/json'
```

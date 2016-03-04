## Genes collection
###  dump genes from ensembl core and otherfeatures databases
dump_genes.js extracts the gene models, xrefs, and interpro protein annotations on the canonical translation from a core or otherfeatures database.

createDumpCommands.js interrogates the mysql server hosting ensembl databases and generates command lines for dump_genes.js.
Dump gzipped json docs from each database.
```
cd <gramene-mongodb>/search
mkdir tmp
./createDumpCommands.js -g 50 -e 84 -h host -u user -p pass | parallel
```

### populate auxiliary mongodb collections
Go populate the genetree, pathways, ontologies, and maps collections.
### load homologue lookup table
```
nohup redis-server &
dump_homologs.js -h host -u user -p pass -d ensembl_compara_plants_50_84 | redis-cli --pipe
```

### finish the gene documents
Once all that is done:
```
 gzcat tmp/*.json.gz | \
 node --max-old-space-size=8192 ./decorate.js -i /dev/fd/0 -o insertion_errors.jsonl -p <pathToAssociationsFile> -d ensembl_compara_plants_50_84
```

Final step is to build indexes
```
mongo search50 < indexCommands.txt
```

One more thing...
go back over to the trees subdirectory and add domains to the gene trees
```
cd ../trees
node add_domains_to_tree.js
```

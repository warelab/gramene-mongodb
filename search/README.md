## Genes collection
### populate auxiliary mongodb collections
Go populate the genetree, pathways, ontologies, and maps collections.

###  dump genes from ensembl databases
dump_genes.js extracts the gene models, xrefs, and interpro protein annotations on the canonical translation from a core or otherfeatures database.

createDumpCommands.js interrogates the maps collection on the mongodb server and generates command lines for dump_genes.js.
```
cd <gramene-mongodb>/search
mkdir tmp
./createDumpCommands.js -h host -u user -p pass | parallel
```

### load homologue lookup table
```
nohup redis-server &
dump_homologs.js -h host -u user -p pass -d ensembl_compara_plants_51_85 | redis-cli --pipe
```

### finish the gene documents
Once all that is done:
```
 gzcat tmp/*.json.gz | \
 node --max-old-space-size=8192 ./decorate.js -i /dev/fd/0 -o insertion_errors.jsonl -p <pathToAssociationsFile> -d ensembl_compara_plants_51_85
```

Final step is to build indexes
```
mongo search51 < indexCommands.txt
```

One more thing...
go back over to the trees subdirectory and add domains to the gene trees
```
cd ../trees
node add_domains_to_tree.js ensembl_compara_plants_51_85
```

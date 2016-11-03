# Import EPl Gene Trees from compara database
Build the gene trees (and load into mongo)
```
node genetree.js -h host -u user -p pass -d ensembl_compara_plants_48_82
node genetree.js -h host -u user -p pass -d ensembl_compara_pan_homology_48_82
```
Index the compara_db field so we can query for that subset of trees to populate homology info in genes docs
```
mongo search49
db.genetree.ensureIndex({compara_db:1})
```_
Go do the rest of the things in ../search and then come back here to add domains to the gene trees
```
node add_domains_to_tree.js
```

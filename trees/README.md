# Import EPl Gene Trees from compara database
Build the gene trees (and load into mongo)
```
node genetree.js -h host -u user -p pass -d ensembl_compara_plants_48_82
```
Go do the rest of the things in ../search and then come back here to add domains to the gene trees
```
node add_domains_to_tree.js
```

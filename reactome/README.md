## pathway collection
Create JSON documents from the pathway hierarchy:
```
./extract_docs_from_reactome.js http://data.gramene.org/reactome > pathways.json
mongoimport -h brie -d search48 -c pathways < pathways.json
```./get_species_prefixes.js > merge_into_taxonomy.json
mongoexport -h brie -d search52 -c taxonomy -q '{subset: "gramene"}' | node ../search/merge_into_mongo_docs.js -l ../reactome/merge_into_taxonomy.json | mongoimport -h brie -d search52 -c taxonomy --upsert

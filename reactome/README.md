## pathway collection
Create JSON documents from the pathway hierarchy:
```
./extract_docs_from_reactome.js http://data.gramene.org/reactome > pathways.json
mongoimport -h brie -d search48 -c pathways < pathways.json
```
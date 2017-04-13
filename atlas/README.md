curl 'ftp://ftp.ebi.ac.uk:/pub/databases/microarray/data/atlas/experiments/assaygroupsdetails.tsv' | node --max-old-space-size=8192 ./getAtlasData.js
node --max-old-space-size=8192 ./parseBaseline.js E-* > merge_into_genes.json 
mongoexport -h brie -d search53 -c genes | node ../search/merge_into_mongo_docs.js -l ../atlas/merge_into_genes.json  | mongoimport -h brie -d search53 -c genes --upsert

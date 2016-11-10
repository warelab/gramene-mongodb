curl 'ftp.ebi.ac.uk:/pub/databases/microarray/data/atlas/experiments/assaygroupsdetails.tsv' > assaygroupsdetails.tsv
cat assaygroupsdetails.tsv | node --max-old-space-size=8192 ./getAtlasData.js > merge_into_genes.json
mongoexport -h brie -d search52 -c genes | node ../search/merge_into_mongo_docs.js -l /Users/olson/src/warelab/gramene-mongodb/atlas/merge_into_genes.json  | mongoimport -h brie -d search52 -c genes --upsert

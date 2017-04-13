curl 'ftp://ftp.ebi.ac.uk/pub/databases/microarray/data/atlas/experiments/assaygroupsdetails.tsv' | node --max-old-space-size=8192 ./getAtlasData.js
node --max-old-space-size=8192 ./parseBaseline.js E-*.tsv | mongoimport -h brie -d search53 -c atlas

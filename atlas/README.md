curl 'ftp://ftp.ebi.ac.uk/pub/databases/microarray/data/atlas/experiments/ebeye_baseline_experiments_export.xml' > ebeye_baseline_experiments_export.xml
curl 'ftp://ftp.ebi.ac.uk/pub/databases/microarray/data/atlas/experiments/assaygroupsdetails.tsv' > assaygroupdetails.tsv
node --max-old-space-size=8192 ./getAtlasData.js ebeye_baseline_experiments_export.xml assaygroupdetails.tsv
node --max-old-space-size=8192 ./parseBaseline.js E-*.tsv > expression.jsonl
mongoimport -h brie -d search54 -c expression --drop expression.jsonl
mongo -h brie -d search54
> db.assays.ensureIndex({taxon_id:1})
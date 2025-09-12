curl -O ftp://ftp.ebi.ac.uk/pub/databases/microarray/data/atlas/experiments/assaygroupsdetails.tsv
curl -O ftp://ftp.ebi.ac.uk/pub/databases/microarray/data/atlas/experiments/contrastdetails.tsv
node --max-old-space-size=8192 ./getAtlasData.js assaygroupdetails.tsv | /bin/sh
node --max-old-space-size=8192 ./getAtlasData.js contrastdetails.tsv | /bin/sh
node --max-old-space-size=8192 ./parseData.js E-*.tsv 

#!/usr/bin/env bash

HOST=cabot
USER=gramene_web
PASS=gram3n3
DB=ensembl_compara_plants_46_80

echo "Dumping data from $DB on $HOST"

# echo "Nodes…"
# mysql -h$HOST -u$USER -p$PASS $DB -q < gene_node.sql > gene_node.txt

echo "Edges…"
mysql -h$HOST -u$USER -p$PASS $DB -q < homologue_edge.sql > homologue_edge.txt

echo "Done dumping"

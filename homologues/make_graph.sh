#!/usr/bin/env bash

export NEO_DB=./homology.db
export NEO_DATA_DIR=/usr/local/Cellar/neo4j/2.2.5/libexec/data/


echo "Loading data into new graph database at $NEO_DB"
neo4j-import --into $NEO_DB --id-type string \
             --nodes:Gene gene_node.txt \
             --relationships:HOMOLOGY homologue_edge.txt \
             --delimiter TAB

neo4j stop
mv $NEO_DATA_DIR/graph.db $NEO_DATA_DIR/graph.$(date +%s).db
mv $NEO_DB $NEO_DATA_DIR/graph.db
neo4j start
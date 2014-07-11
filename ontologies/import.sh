cat *.Global.json | mongoimport --db ontology --collection Global
mongoimport --db ontology --collection go < go.Term.json
mongoimport --db ontology --collection ncbitaxon < ncbitaxon.Term.json
mongoimport --db ontology --collection plant_ontology < plant_ontology.Term.json
mongoimport --db ontology --collection trait < trait.Term.json

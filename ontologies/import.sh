cat *.Global.json | mongoimport --db ontologies --collection Global
mongoimport --db ontologies --collection go < go.Term.json
mongoimport --db ontologies --collection ncbitaxon < ncbitaxon.Term.json
mongoimport --db ontologies --collection plant_ontology < plant_ontology.Term.json
mongoimport --db ontologies --collection trait < trait.Term.json

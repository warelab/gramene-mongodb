# Ontology collections
The ontology collections hold hierarchically related terms as documents. They provide information on ontology terms and support more complex queries of annotated genes. The is_a and part_of relationships are traversed to form a list of ancestors in each term document. That way you can query for genes annotated with a GO term or any more specific terms on the GO__ancestors field in the gramene-solr genes core.
## Populating the collections
### InterPro
Download files, parse, and import documents
```
mkdir tmp
curl -s ftp://ftp.ebi.ac.uk/pub/databases/interpro/ParentChildTreeFile.txt > tmp/ParentChildTreeFile.txt
curl -s ftp://ftp.ebi.ac.uk/pub/databases/interpro/interpro.xml.gz | gzip -cd | node parseInterpro.js tmp/ParentChildTreeFile.txt /dev/fd/0 | mongoimport --host hostname --db dbname --collection domains
```
### populate other collections from .obo files
```
./populate.js -t tmp -h hostname -u username -p password --compara ensembl_compara_plants_49_83 --pan ensembl_compara_pan_homology_49_83
```

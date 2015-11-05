# Ontology collections
The ontology collections hold hierarchically related terms as documents. They provide information on ontology terms and support more complex queries of annotated genes. The is_a and part_of relationships are traversed to form a list of ancestors in each term document. That way you can query for genes annotated with a GO term or any more specific terms on the GO__ancestors field in the gramene-solr genes core.
## Populating the collections
### special case: InterPro
Download files, parse, and import documents
```
mkdir tmp
curl -s ftp://ftp.ebi.ac.uk/pub/databases/interpro/ParentChildTreeFile.txt > tmp/ParentChildTreeFile.txt
curl -s ftp://ftp.ebi.ac.uk/pub/databases/interpro/interpro.xml.gz | gzip -cd | node parseInterpro.js tmp/ParentChildTreeFile.txt /dev/fd/0 | mongoimport --host brie --db search48 --collection domains

mongo search48
> db.domains.ensureIndex({"$**":"text"})
```
### populate collections from .obo files
```
./populate.js tmp
```
## Example queries
```
$ mongo ontology
> db.GO.find({_id:16746})
> db.GO.find({_ancestors:16746}).count()
> db.GO.find({ $text: { $search: "H3-K9 methylation" }},{ name:1,namespace:1,score: { $meta: "textScore"}}).sort({score: {$meta: "textScore"}})
```

<!-- ## Setting up Solr cores for each collection
The solr subdirectory contains a script that will convert a stream of JSON documents exported from mongodb into a list of JSON documents that can be imported into solr. The schema.xml and solrconfig.xml files can be used to set up the core.
#### export and convert mongodb docs for solr
First do facet counts on the *_ancestors fields of the genes solr core. This is used to populate the _genes field in each core.
```
curl "http://data.gramene.org/search/genes?q=*:*&rows=0&facet=true&facet.field=GO_ancestors&facet.limit=-1&json.nl=map&facet.field=PO_ancestors&facet.field=NCBITaxon_ancestors&facet.field=interpro_ancestors"  > facet_counts.js
edit facet_counts.js so it is more like:
module.exports = {GO_ancestors:{},PO_ancestors:{}, etc}

mongoexport -d ontology -c GO | node ontology2solr.js /dev/fd/0 GO_ancestors > GO.json
mongoexport -d ontology -c PO | node ontology2solr.js /dev/fd/0 PO_ancestors > PO.json
mongoexport -d ontology -c NCBITaxon | node ontology2solr.js /dev/fd/0 NCBITaxon_ancestors > taxonomy.json
mongoexport -d ontology -c interpro | node ontology2solr.js /dev/fd/0 interpro_ancestors > interpro.json
```
#### import into a running solr instance
```
curl 'http://localhost:8983/solr/GO/update?commit=true' --data-binary @GO.json -H 'Content-type:application/json'
curl 'http://localhost:8983/solr/PO/update?commit=true' --data-binary @PO.json -H 'Content-type:application/json'
curl 'http://localhost:8983/solr/taxonomy/update?commit=true' --data-binary @taxonomy.json -H 'Content-type:application/json'
curl 'http://localhost:8983/solr/interpro/update?commit=true' --data-binary @interpro.json -H 'Content-type:application/json'
``` -->
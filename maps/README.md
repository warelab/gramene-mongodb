# populating genomic maps
```
./dump_maps.js -h host -u user -p pass -g 48 -e 82 > maps.json
mongoimport -h brie -d search48 -c maps < maps.json
```


<!-- # (comparative) maps -- future work

Lets first define some terms

- map: a linear representation of DNA.
- feature: an annotated interval on a map
- featureFormat: the format of a feature
- featureSet: a collection of features on the same map with the same format
- remapper: a function than can project features from one map to another
- correspondence: a pair of features that are linked somehow
- correspondenceSet: A set of correspondences between features from 2 featureSets.
- correspondenceType: the type of correspondence e.g., synteny

###Data can be stored in MongoDB and FastBit.

MongoDB collections: maps, features, correspondences, formats, and remappers

The features in each featureSet is stored in a FastBit partition sorted by region and position. The order of regions
needs to match the associated maps document (not necessarily sorted lexicographically)

Correspondences between features from featureSets A and B are stored as a linearized bit matrix. Only
store the positions of the set bits. Since it is very sparse, that would be more compact and
easy to work with than a CmpBitVec.

Example maps document
```
{
  "id"          : "GCA_000001735.1",
  "system_name" : "arabidopsis_thaliana",
  "taxon_id"    : 3702,
  "name"        : "TAIR10 assembly",
  "type"        : "genome", // extra info in the formats collection
  "length"      : 119667750,
  "regions"     :
  {
    "names"   : ["1", "2", "3", "4", "5", "Mt", "Pt", "Un"],
    "lengths" : [30427671, 19698289, 23459830, 18585056, 26975502, 366924, 154478, 88888]
  }
}
```
Example features document
```
{
  "id"     : "automatically generated ID",
	"name"   : "genes",
	"map"    : "GCA_000001735.1",
	"type"   : "gene", // id of the corresponding document in the formats collection
	"counts" : [8433, 5513, 6730, 5140, 7507, 146, 133, 0],
  "count"  : 33602
}
```
Example correspondences document
```
{
  "featureSetA" : "foo",
  "featureSetB" : "bar",
	"type"        : "synteny", // extra info in the features collection?
  "matrix"      : [0, 234, 300, 543, 788, 5544, 12313, 12324]
}
```
Example formats document
```
// these examples are too much like FastBit's -part.txt file
// change "columns" to "properties" so we can use revalidator.js
// The syntactical mapping from properties to a FastBit -part.txt file should be done elsewhere
{
  "id"      : "gene",
  "columns" : [
    {
      "name" : "region",
      "type" : "USHORT"
      "info" : "the index of the region in the maps document"
    },
		{
			"name" : "start",
			"type" : "UINT",
			"info" : "the start position of the gene"
		},
		{
			"name" : "end",
			"type" : "UINT",
			"info" : "the end position of the gene"
		},
		{
			"name" : "orientation",
			"type" : "USHORT",
			"info" : "the orientation of the gene"
		},
    {
      "name" : "gene_id",
      "type" : "STRING",
      "info" : "unique identifier for the gene"
    }
  ]
}
// methylation data can be large, might need to partition by context and/or region
// and make them meta-tags. Postponing that optimization.
{
	"id"      : "methylation",
	"columns" : [
    {
      "name" : "region",
      "type" : "USHORT",
      "info" : "the index of the region in the maps document"
    },
		{
			"name" : "position",
			"type" : "UINT",
			"info" : "the position of the (un)methylated cytosine on the map"
		},
		{
			"name" : "context",
			"type" : "KEYWORD",
			"info" : "the context of the cytosine (CpG, CHG, CHH)"
		},
			"name" : "C",
			"type" : "USHORT",
			"info" : "the number of reads reporting a C at this position"
		},
			"name" : "CT",
			"type" : "USHORT",
			"info" : "the total number of reads aligning to this position"
		},
		{
			"name" : "ratio",
			"type" : "FLOAT",
			"info" : "C/CT is the methylation ratio"
		}
	]
}
// The formats collection can also store the schema for each of the other collections (and itself)
```
Example remappers document
```
{
	"sourceMap"   : {map id},
  "sourceStart" : {position},
  "sourceEnd"   : {position},
	"destMap"     : {map id},
  "destStart"   : {position},
  "destEnd"     : {position},
  "flip"        : {boolean}>
}
```
Use indexes that let you find the remapper document given the source and destination map ids and a position on the source map. When projecting a set of features from one map to another, pull the relevant documents sorted by position. N.B. some functions are bijections while others are not (genome -> aggregated promoter regions). -->

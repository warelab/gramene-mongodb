# (comparative) maps

Lets first define some terms

- map: a linear representation of something like DNA. e.g., chromosome, scaffold, contig, etc.
- mapSet: a collection of related maps. e.g. a genome assembly
- feature: an annotated interval on a map
- featureSet: a collection of features from the same mapSet with the same format. e.g., methylation data set x
- featureFormat: format of features in a featureSet
- correspondence: a pair of features that are linked somehow
- correspondenceSet: A set of correspondences between features on 2 featureSets.
- correspondenceType: the type of correspondence e.g., synteny
- virtualMap: a map defined by a set of features, e.g., promoter regions (-2000,500) relative to TSS
- remapper: a function that defines a relation from one map to another (usu. virtualMap, also whole genome alignments)

###Data can be stored in MongoDB and FastBit.

MongoDB collections: mapSet, featureSet, featureFormat, and correspondenceSet

The features are stored in FastBit tables partitioned by featureSet and map.
All features in a featureSet have the same format. The featureFormat determines what columns are stored.

Correspondences between features on maps A and B are stored as a linearized bit matrix. you only have
to store the positions of the set bits. Since it is very sparse, that would be more compact and 
efficient to work with than a CmpBitVec. The reason correspondences are partitioned by the 4-tuple
(featureSetA, featureSetB, mapA, mapB) is so you can extract the features from mapA and mapB quickly
by creating bit vector masks for use on the featureSetA/mapA and featureSetB/mapB FastBit partitions

Example mapSet document
```
{
	"name" : "Sbi1.4",
	"maps" : {
		"1" : { "type" : "chromosome", "length" : 123456789 },
		"2" : { "type" : "chromosome", "length" : 112233445 }
	}
}
```
Example featureSet document
```
{
	"name"          : "Sorghum root methylation",
	"mapSet"        : "Sbi1.4",
	"featureFormat" : "methylation",
	"features"      : {
		"map" : "/path to fastbit partition"
	}
}
```
Example featureFormat document
```
{
	"name"    : "methylation",
	"columns" : [
		{
			"name" : "position",
			"type" : "ULONG",
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
```
Example correspondenceSet document 
```
{
	"featureSetA" : <featureSet id>,
	"featureSetB" : <featureSet id>,
	"type"        : <correspondence type> // is this just a label or does it require a separate table?
	"correspondences" : [
		{
			"mapA"   : <map id>,
			"mapB"   : <map id>,
			"matrix" : [position list]
		}
	]
}
```
Example virtualMap document
```
{
	"mapA" : <map id>,
	"mapB" : <map id>,
	"function" : [[A1,A2,B1,B2,flip]] // sorted by A1 - keep it here or store on disk (FastBit)?
}
```

store the function in a fastbit partition. Since features on a map are sorted (check .part.txt), doing the projection is linear in the number of
intervals in the function and the number of features on the map.
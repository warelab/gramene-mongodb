@Grab('com.xlson.groovycsv:groovycsv:1.0')
@Grab(group = 'com.sparkjava', module = 'spark-core', version = '2.1')

import static spark.Spark.*
import groovy.json.*

final Map<String, List<Homology>> lut = new HashMap(2**22).withDefault { new LinkedList<Homology>() }

Integer count = 0

enum HomologyKind {
  ortholog_one2one,
  within_species_paralog,
  ortholog_one2many,
  ortholog_many2many,
  homoeolog_one2one,
  homoeolog_one2many,
  gene_split,
  homoeolog_many2many,
  other_paralog
}

class Homology {
  String otherGene
  HomologyKind kind
  Boolean isTreeCompliant
}

for (line in new File('./homologue_edge.txt').newReader('UTF-8')) {
  if (count++) {
    String[] tokens = line.split('\t')
    String geneA = tokens[0]
    String geneB = tokens[1]
    HomologyKind kind = HomologyKind.valueOf(tokens[2])
    Boolean isTreeCompliant = tokens[4] == '1'

    lut[geneA] << new Homology(otherGene: geneB, kind: kind, isTreeCompliant: isTreeCompliant)
    lut[geneB] << new Homology(otherGene: geneA, kind: kind, isTreeCompliant: isTreeCompliant)
    if (count % 1000000 == 0) {
      println "$count ${lut.size()}"
    }
  }
}

println 'Done. Will attempt to start a server.'

get '/homologs', { req, res ->
  res.type('application/json')

  String geneId = req.queryMap().toMap().for[0]
  List<Homology> homologies = lut[geneId]
  new JsonBuilder(homologies.collect{ h ->
    [otherGene: h.otherGene, kind: h.kind, isTreeCompliant: h.isTreeCompliant]
  })
}
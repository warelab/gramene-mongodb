@Grab('com.xlson.groovycsv:groovycsv:1.0')

import groovy.json.*

HomologyLut lut = HomologyLut.fromCsv('./homologue_edge.txt')

JsonSlurper jsonSlurper = new JsonSlurper();
//BufferedReader input = new BufferedReader(new InputStreamReader(System.in))
BufferedReader input = new BufferedReader(new FileReader('../Gene_Aegilops_tauschii_core.for_genetree_testing.json'))
//BufferedWriter output = new BufferedWriter(new OutputStreamWriter(System.out))
BufferedWriter output = new BufferedWriter(new FileWriter('../Gene_Aegilops_tauschii_core.for_genetree_testing.out.json'))

int count = 0
int time = System.currentTimeMillis()

input.eachLine {
  if(++count % 10000 == 0) {
    int now = System.currentTimeMillis()
    int dur = now - time;
    console.log("$count in $dur ms")
    time = now
  }
  Map gene = jsonSlurper.parseText it
  gene.homologs = lut.homologs(gene._id)
  String prettyGene = new JsonBuilder(gene).toPrettyString()
  output.write prettyGene
}


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

class Homology implements Serializable {
  String otherGene
  HomologyKind kind
  Boolean isTreeCompliant
}

class HomologyLut implements Serializable {

  final Map<String, List<Homology>> lut = new HashMap(2**22)// .withDefault { new LinkedList<Homology>() }
  Integer count = 0

  static HomologyLut fromCsv(String fileName) {
    HomologyLut lut = new HomologyLut()
    lut.loadFromCsv(fileName)
    return lut
  }

  private def loadFromCsv(String fileName) {
    for (line in new File(fileName).newReader('UTF-8')) {
      if (count++) {
        String[] tokens = line.split('\t')
        String geneA = tokens[0]
        String geneB = tokens[1]
        HomologyKind kind = HomologyKind.valueOf(tokens[2])
        Boolean isTreeCompliant = tokens[3] == '1'

        if(lut[geneA] == null) lut[geneA] = new LinkedList<>()
        if(lut[geneB] == null) lut[geneB] = new LinkedList<>()

        lut[geneA] << new Homology(otherGene: geneB, kind: kind, isTreeCompliant: isTreeCompliant)
        lut[geneB] << new Homology(otherGene: geneA, kind: kind, isTreeCompliant: isTreeCompliant)
        if (count % 1000000 == 0) {
          println "$count ${lut.size()}"
        }
      }
    }
  }

  List<Homology> homologs(geneId) {
    return lut[geneId]
  }
}
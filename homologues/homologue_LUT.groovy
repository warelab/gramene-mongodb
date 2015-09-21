#!/usr/bin/env groovy

@Grab('com.xlson.groovycsv:groovycsv:1.0')

import groovy.json.*

import java.util.zip.GZIPInputStream

//"bash dump_data.sh".execute().in.eachLine { line ->
//  System.err.println line
//}
HomologyLut lut = CsvHomologyLutFactory.from('./homologue_edge.txt.gz').create()
//HomologyLut lut = MysqlHomologyLutFactory.get().create()

JsonSlurper jsonSlurper = new JsonSlurper();
BufferedReader input = new BufferedReader(new InputStreamReader(System.in))
BufferedWriter output = new BufferedWriter(new OutputStreamWriter(System.out))
//BufferedReader input = new BufferedReader(new FileReader('../Gene_Aegilops_tauschii_core.for_genetree_testing.json'))
//BufferedWriter output = new BufferedWriter(new FileWriter('../Gene_Aegilops_tauschii_core.for_genetree_testing.out.json'))

System.err.println "Adding homologs to JSON docs"
int count = 0
int time = System.currentTimeMillis()

input.eachLine { line ->
  if(++count % 10000 == 0) {
    int now = System.currentTimeMillis()
    int dur = now - time;
    System.err.println "10000 modified in $dur ms; $count total"
    time = now
  }
  Map gene = jsonSlurper.parseText line
  gene.homologs = lut.homologs gene._id
  String prettyGene = new JsonBuilder(gene).toString()
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

  static Map<String, HomologyKind> enumlut

  static {
    Map<String, HomologyKind> temp = new HashMap()
    for(HomologyKind kind in values()) {
      temp[kind.toString()] = kind
    }
    enumlut = Collections.unmodifiableMap(temp)
  }

  // valueOf is very slow.
  static fromString(String s) {
    return enumlut[s]
  }
}

class Homology implements Serializable {
  String otherGene
  HomologyKind kind
  Boolean isTreeCompliant
}

class HomologyLut implements Serializable {

  private final Map<String, List<Homology>> lut = new HashMap(2**22).withDefault { new ArrayList<Homology>(50) }
  private int homologyCount = 0

  def addHomology(String geneId, Homology homology) {
    ++homologyCount
    lut[geneId] << homology
  }

  List<Homology> homologs(String geneId) {
    return lut[geneId]
  }

  int size() {
    return lut.size()
  }

  int homologyCount() {
    return homologyCount;
  }
}

interface HomologyLutFactory {
  HomologyLut create()
}

class MysqlHomologyLutFactory implements HomologyLutFactory {

  String host = 'cabot'
  String db = 'ensembl_compara_plants_46_80'
  String user = 'gramene_web'
  String pass = 'gram3n3'

  int count = 0

  static MysqlHomologyLutFactory get() {
    return new MysqlHomologyLutFactory()
  }

  @Override
  HomologyLut create() {
    HomologyLut lut = new HomologyLut()
    String query = new File('homologue_edge.sql').text
    def mysqlProc = "mysql -h$host -u$user -p$pass $db -q".execute()
    mysqlProc.out.withWriter{ w ->
      w.write query
    }
    new BufferedReader(new InputStreamReader(mysqlProc.in)).eachLine { String line ->
      if(count++) {
        def (String geneA, String geneB, kind, isTreeCompliant) = line.split(/\t/)
        kind = HomologyKind.fromString((String) kind)
        isTreeCompliant = isTreeCompliant == '1'

        lut.addHomology(geneA, new Homology(otherGene: geneB, kind: kind, isTreeCompliant: isTreeCompliant))
        lut.addHomology(geneB, new Homology(otherGene: geneA, kind: kind, isTreeCompliant: isTreeCompliant))
        if (count % 10000 == 0) {
          System.err.print '.'
        }
      }
    }
  }
}

class CsvHomologyLutFactory implements HomologyLutFactory {

  String fileName

  int count = 0

  static CsvHomologyLutFactory from(String fileName) {
    return new CsvHomologyLutFactory(fileName: fileName)
  }

  @Override
  HomologyLut create() {
    System.err.println "Loading lookup table from $fileName"
    HomologyLut lut = new HomologyLut()
    for (line in new BufferedInputStream(new GZIPInputStream(new FileInputStream(fileName))).newReader('UTF-8')) {
      if (count++) {
        String[] tokens = line.split('\t')
        String geneA = tokens[0]
        String geneB = tokens[1]
        HomologyKind kind = HomologyKind.valueOf(tokens[2])
        Boolean isTreeCompliant = tokens[3] == '1'

        lut.addHomology(geneA, new Homology(otherGene: geneB, kind: kind, isTreeCompliant: isTreeCompliant))
        lut.addHomology(geneB, new Homology(otherGene: geneA, kind: kind, isTreeCompliant: isTreeCompliant))
        if (count % 1000000 == 0) {
          System.err.print '.'
        }
      }
    }
    System.err.println "LUT has ${lut.homologyCount()} records in ${lut.size()} genes"
    return lut
  }
}
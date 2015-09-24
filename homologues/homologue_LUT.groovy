#!/usr/bin/env groovy
@Grab('com.xlson.groovycsv:groovycsv:1.0')
@Grab('mysql:mysql-connector-java:5.1.25')
@GrabConfig(systemClassLoader = true)

import groovy.json.*
import groovy.sql.Sql

import java.sql.ResultSet
import java.util.zip.GZIPInputStream

Long overallStart = System.currentTimeMillis()

def cl = new CliBuilder(usage: 'homologue_LUT.groovy [-f <factoryType>] [-i <input file] [-o <output file>]')
cl.f(longOpt:'factoryType', args: 1, 'Define factory. Must be one of "Csv", "Mysql", "JDBC". (These names aren\'t very descriptive)')
cl.i(longOpt:'in', args: 1, 'Input file')
cl.o(longOpt:'out', args: 1, 'Output file')

def opts = cl.parse(args)

String factoryType = opts.f ?: 'JDBC'
InputStream inStream = opts.i ? new FileInputStream(opts.i) : System.in
OutputStream outStream = opts.o ? new FileOutputStream(opts.o) : System.out

Class<HomologyLutFactory> factory = Class.forName("${factoryType}HomologyLutFactory")

HomologyLut lut = factory.get().create()

JsonSlurper jsonSlurper = new JsonSlurper();
BufferedReader input = new BufferedReader(new InputStreamReader(inStream))
BufferedWriter output = new BufferedWriter(new OutputStreamWriter(outStream))

System.err.println "Adding homologs to JSON docs"
int count = 0
int time = System.currentTimeMillis()

input.eachLine { line ->
  if (++count % 10000 == 0) {
    int now = System.currentTimeMillis()
    int dur = now - time;
    System.err.println "10000 modified in $dur ms; $count total"
    time = now
  }
  Map gene = jsonSlurper.parseText line
  String geneId = gene._id
  List<Homology> homologies = lut.homologs geneId
  if (homologies) {
    gene.homologs = homologies.groupBy {
      it.kind
    }
    .each { Map.Entry e ->
      e.value = e.value.collect { h -> h.otherGene }
    }
  }
  String prettyGene = new JsonBuilder(gene).toString()
  output.write prettyGene
}

System.err.println "It took ${System.currentTimeMillis() - overallStart}ms to run this thing."

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
    for (HomologyKind kind in values()) {
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
    "Getting lookup table from mysql on $host"
    HomologyLut lut = new HomologyLut()
    String query = new File('homologue_edge.sql').text
    def mysqlProc = "mysql -h$host -u$user -p$pass $db -q".execute()
    mysqlProc.out.withWriter { w ->
      w.write query
    }
    new BufferedReader(new InputStreamReader(mysqlProc.in)).eachLine { String line ->
      if (count++) {
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
    return lut
  }
}

class JDBCHomologyLutFactory implements HomologyLutFactory {

  Map dbParams = [
      url     : 'jdbc:mysql://cabot/ensembl_compara_plants_46_80',
      user    : 'gramene_web',
      password: 'gram3n3',
      driver  : 'com.mysql.jdbc.Driver'
  ]
  int count = 0
  final int batch = 100000
  int lastBatch = batch

  static HomologyLutFactory get() {
    return new JDBCHomologyLutFactory()
  }

  @Override
  HomologyLut create() {
    System.err.println "Getting lookup table from mysql on $dbParams.url"
    def sql = Sql.newInstance(dbParams)
    HomologyLut lut = new HomologyLut()

    String query = new File('homologue_edge.sql').text

    // implement batching explicitly here using LIMIT in query because mysql
    // JDBC driver doesn't support it properly and gets ALL ROWS.
    while (lastBatch == batch) {
      String batchQuery = query.replace(';', " LIMIT $count,$batch;")

      // use sql.query rather than sql.eachRow to reduce object creation overhead
      sql.query(batchQuery) { ResultSet rs ->
        lastBatch = 0
        while(rs.next()) {
          ++lastBatch
          HomologyKind kind = HomologyKind.fromString(rs.getString('kind'))
          String geneId1 = rs.getString('geneId').intern()
          String geneId2 = rs.getString('otherId').intern()
          Boolean isTreeCompliant = rs.getBoolean('isTreeCompliant')

          lut.addHomology(geneId1, new Homology(otherGene: geneId2, kind: kind, isTreeCompliant: isTreeCompliant))
          lut.addHomology(geneId2, new Homology(otherGene: geneId1, kind: kind, isTreeCompliant: isTreeCompliant))
        }
      }

      System.err.print '.'
    }

    System.err.println ' done.'
    System.err.println "LUT has ${lut.homologyCount()} records in ${lut.size()} genes"
    return lut
  }
}

class CsvHomologyLutFactory implements HomologyLutFactory {

  String fileName

  int count = 0

  static CsvHomologyLutFactory get() {
    return new CsvHomologyLutFactory(fileName: './homologue_edge.txt.gz')
  }

  @Override
  HomologyLut create() {

    "bash dump_data.sh".execute().in.eachLine { line ->
      System.err.println line
    }

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
#!/usr/bin/env groovy
@Grab('com.xlson.groovycsv:groovycsv:1.0')
@Grab('mysql:mysql-connector-java:5.1.25')
@GrabConfig(systemClassLoader = true)

import groovy.json.*
import groovy.sql.Sql
import groovy.util.logging.Log

import java.sql.ResultSet

final long overallStart = System.currentTimeMillis()

def cl = new CliBuilder(usage: 'homologue_LUT.groovy [-i <input file] [-o <output file>] [-v]')
cl.i(longOpt: 'in', args: 1, 'Input file (defaults to stdin)')
cl.o(longOpt: 'out', args: 1, 'Output file (defaults to stdout)')
cl.d(longOpt: 'debug', args: 0, 'Send some logging info to stderr')

def opts = cl.parse(args)

final InputStream inStream = opts.i ? new FileInputStream(opts.i) : System.in
final OutputStream outStream = opts.o ? new FileOutputStream(opts.o) : System.out

HomologAdder.run(inStream, outStream)

log "It took ${System.currentTimeMillis() - overallStart}ms to run the whole thing."


/**
 * Adds homolog information to each gene document in a stream
 */
@Log
class HomologAdder {
  static run(InputStream inStream, OutputStream outStream) {
    final HomologyLut lut = JDBCHomologyLutFactory.instance.create()

    final JsonSlurper jsonSlurper = new JsonSlurper();
    final BufferedReader input = new BufferedReader(new InputStreamReader(inStream))
    final BufferedWriter output = new BufferedWriter(new OutputStreamWriter(outStream))

    log.info "Adding homologs to JSON docs"
    int count = 0
    long time = System.currentTimeMillis()

    input.eachLine { line ->
      if (++count % 10000 == 0) {
        int now = System.currentTimeMillis()
        int dur = now - time;
        log.info "10000 modified in $dur ms; $count total"
        time = now
      }
      def gene = jsonSlurper.parseText line
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
      output.writeLine prettyGene
    }
  }
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

  static final Map<String, HomologyKind> enumlut

  static {
    Map<String, HomologyKind> mutable = new HashMap()
    for (HomologyKind kind in values()) {
      mutable[kind.toString()] = kind
    }
    enumlut = Collections.unmodifiableMap(mutable)
  }

  // valueOf seems to be slow.
  static fromString(String s) {
    return enumlut[s]
  }
}

class Homology implements Serializable {
  String otherGene
  HomologyKind kind
  Boolean isTreeCompliant
}

@Singleton
class HomologyLut implements Serializable {

  private final Map<String, List<Homology>> lut = new HashMap(2**22).withDefault { new ArrayList<Homology>() }
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

@Log
@Singleton
class JDBCHomologyLutFactory {

  Map dbParams = [
      url                 : 'jdbc:mysql://cabot/ensembl_compara_plants_46_80',
      user                : 'gramene_web',
      password            : 'gram3n3',
      driver              : 'com.mysql.jdbc.Driver',

      // Incantations to get MySQL JDBC to stream. OMG.
      // Adapted from http://stackoverflow.com/a/2448019
      resultSetConcurrency: ResultSet.CONCUR_READ_ONLY,
      resultSetType       : ResultSet.TYPE_FORWARD_ONLY,
  ]

  int count = 0
  final int batch = 1000000

  HomologyLut create() {
    log.info "Getting lookup table from mysql on $dbParams.url"
    final long start = System.currentTimeMillis()
    final HomologyLut lut = HomologyLut.instance
    final def sql = Sql.newInstance(dbParams)

    // Another incantation to get MySQL JDBC to stream. OMG.
    // Adapted from http://stackoverflow.com/a/2448019
    sql.withStatement { stmt -> stmt.fetchSize = Integer.MIN_VALUE }

    // use sql.query rather than sql.eachRow to reduce object creation overhead
    sql.query(HomologueQuery.get()) { ResultSet rs ->
      while (rs.next()) {
        ++count
        HomologyKind kind = HomologyKind.fromString(rs.getString('kind'))

        // intern() strings to save a lot of memory.
        String geneId1 = rs.getString('geneId').intern()
        String geneId2 = rs.getString('otherId').intern()
        Boolean isTreeCompliant = rs.getBoolean('isTreeCompliant')

        lut.addHomology(geneId1, new Homology(otherGene: geneId2, kind: kind, isTreeCompliant: isTreeCompliant))
        lut.addHomology(geneId2, new Homology(otherGene: geneId1, kind: kind, isTreeCompliant: isTreeCompliant))

        if (count % batch == 0) {
          log.info "$count homologies processed"
        }
      }
    }

    log.info "LUT has ${lut.homologyCount()} records in ${lut.size()} genes"
    log.info "LUT took ${System.currentTimeMillis() - start}ms to be created"
    return lut
  }
}

// These classes are declared as a class simply so that I can put it at the end of the file

class HomologueQuery {
  static get() {
    return """
select
g1.stable_id as 'geneId',
g2.stable_id as 'otherId',
h.description as kind,
h.is_tree_compliant as 'isTreeCompliant'

from homology h
inner join homology_member hm on hm.homology_id = h.homology_id
inner join gene_member g1 on hm.gene_member_id = g1.gene_member_id
inner join homology_member hm2 on hm2.homology_id = h.homology_id and hm.gene_member_id > hm2.gene_member_id
inner join gene_member g2 on hm2.gene_member_id = g2.gene_member_id
;
    """.trim()
  }
}
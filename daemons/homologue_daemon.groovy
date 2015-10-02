#!/usr/bin/env groovy
@Grab('com.xlson.groovycsv:groovycsv:1.0')
@Grab('mysql:mysql-connector-java:5.1.25')
@GrabConfig(systemClassLoader = true)

import groovy.json.*
import groovy.sql.Sql
import groovy.util.logging.Log

import java.sql.ResultSet

def cl = new CliBuilder(usage: 'homologue_daemon.groovy ' +
    '-u <mysql uersname> ' +
    '-p <mysql password> ' +
    '[-h <mysql host>] ' +
    '[-d <mysql database>] ' +
    '[-s <socket port>]')
cl.h(longOpt: 'host', args: 1, 'Mysql database host (default `cabot`)')
cl.d(longOpt: 'database', args: 1, 'Name of compara database (default `ensembl_compara_plants_46_80`)')
cl.u(longOpt: 'user', args: 1, 'Mysql username', required: true)
cl.p(longOpt: 'password', args: 1, 'Mysql password', required: true)
cl.s(longOpt: 'socketPort', args: 1, 'Port for the socket server (default is 5432)')

def opts = cl.parse(args)

HomologDaemon.run(opts)

/**
 * Adds homolog information to each gene document in a stream
 */
@Log
class HomologDaemon {
  static HomologyLut lut
  static run(opts) {
    final long overallStart = System.currentTimeMillis()
    lut = JDBCHomologyLutFactory.instance.create(opts)

    Integer socketPort = opts.s ? Integer.parseInt(opts.s) : 5432

    ServerSocket server = new ServerSocket(socketPort)

    log.info "It took ${System.currentTimeMillis() - overallStart}ms to start the daemon"

    while(true) {
      server.accept { socket ->
        println "processing new connection..."
        socket.withStreams HomologDaemon.&addHomologs
        println "processing/thread complete."
      }
    }
  }

  static addHomologs(InputStream inStream, OutputStream outStream) {
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
      output.flush()
    }

    log.info "Done sending docs to that client"
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

  int count = 0
  final int batch = 1000000

  static Sql getSql(opts) {
    Map dbParams = [
        url                 : "jdbc:mysql://${opts.h ?: 'cabot'}/${opts.d ?: 'ensembl_compara_plants_46_80'}",
        user                : opts.u,
        password            : opts.p,
        driver              : 'com.mysql.jdbc.Driver',

        // Incantations to get MySQL JDBC to stream. OMG.
        // Adapted from http://stackoverflow.com/a/2448019
        resultSetConcurrency: ResultSet.CONCUR_READ_ONLY,
        resultSetType       : ResultSet.TYPE_FORWARD_ONLY,
    ]

    log.info "Getting lookup table from mysql on $dbParams.url"

    Sql.newInstance(dbParams)
  }

  HomologyLut create(opts) {
    final long start = System.currentTimeMillis()
    final HomologyLut lut = HomologyLut.instance
    final Sql sql = getSql(opts)

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
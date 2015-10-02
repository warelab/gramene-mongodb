#!/usr/bin/env groovy
@Grab('com.xlson.groovycsv:groovycsv:1.0')
@Grab('mysql:mysql-connector-java:5.1.25')
@GrabConfig(systemClassLoader = true)

import groovy.json.*
import groovy.sql.Sql
import groovy.util.logging.Log

import java.sql.ResultSet

def cl = new CliBuilder(usage: 'add_homologues.groovy [-i <input file] [-o <output file>]')
cl.i(longOpt: 'in', args: 1, 'Input file (defaults to stdin)')
cl.o(longOpt: 'out', args: 1, 'Output file (defaults to stdout)')
cl.s(longOpt: 'socketPort', args: 1, 'Port for the socket server (default is 54321)')

def opts = cl.parse(args)

HomologAdder.run(opts)

/**
 * Adds homolog information to each gene document in a stream
 */
@Log
class HomologAdder {
  static run(opts) {
    final long overallStart = System.currentTimeMillis()
    InputStream inStream = opts.i ? new FileInputStream(opts.i) : System.in
    OutputStream outStream = opts.o ? new FileOutputStream(opts.o) : System.out
    Integer socketPort = opts.s ? Integer.parseInt(opts.s) : 5432

    Socket socket = new Socket("localhost", socketPort)

    final JsonSlurper jsonSlurper = new JsonSlurper();
    final BufferedReader input = new BufferedReader(new InputStreamReader(inStream))
    final BufferedWriter output = new BufferedWriter(new OutputStreamWriter(outStream))

    log.info "Adding homologs to JSON docs"
    int count = 0

    socket.withStreams { socketIn, socketOut ->
      int outCount = 0, backCount = 0
      Thread push = Thread.start {
        Writer outWriter = socketOut.newWriter()
        for(String line in input) {
          outWriter.write(line + '\n')
          ++outCount
        }

        outWriter.flush()
        println "done writing"
      }
      Thread pull = Thread.start {
        long time = System.currentTimeMillis()
        Reader inReader = socketIn.newReader()
        for(String line in inReader) {
          output.writeLine line
          ++backCount
          if(backCount % 10000 == 0) {
            long now = System.currentTimeMillis()
            log.info "$backCount docs; ${now - time}ms"
            time = now
          }
          if(!push.alive && outCount - backCount == 0) {
            break;
          }
        }
        println "done reading"
        inReader.close()
      }
      pull.join()
      log.info "$backCount documents processed"

    }
    log.info "It took ${System.currentTimeMillis() - overallStart}ms to run the whole thing."
  }
}
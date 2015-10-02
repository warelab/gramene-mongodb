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
cl.h(longOpt: 'host', args: 1, 'Host of the socket server (default is localhost)')
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
    String host = opts.h ?: 'localhost'

    Socket socket = new Socket(host, socketPort)

    final JsonSlurper jsonSlurper = new JsonSlurper();


    log.info "Adding homologs to JSON docs"
    int count = 0

    socket.withStreams { socketIn, socketOut ->
      int outCount = 0, backCount = 0
      Thread push = Thread.start {
        final BufferedReader input = new BufferedReader(new InputStreamReader(inStream))
        BufferedWriter output = new BufferedWriter(socketOut.newWriter())

        for(String line in input) {
          output.writeLine line
          ++outCount
        }

        output.flush() // don't close; we're still reading
        log.info "done writing"
      }
      Thread pull = Thread.start {
        long time = System.currentTimeMillis()
        Reader input = socketIn.newReader()
        final BufferedWriter output = new BufferedWriter(new OutputStreamWriter(outStream))
        for(String line in input) {
          output.writeLine line
          ++backCount

          if(backCount % 1000000 == 0) {
            long now = System.currentTimeMillis()
            log.info "$backCount docs; ${now - time}ms"
            time = now
          }
          if(!push.alive && outCount - backCount == 0) {
            break;
          }
        }
        log.info "done reading"
        output.close()
        input.close()
      }
      pull.join()
      log.info "$backCount documents processed"
    }
    log.info "It took ${System.currentTimeMillis() - overallStart}ms to run the whole thing."
  }
}
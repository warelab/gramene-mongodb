#!/usr/bin/env node

var fs = require('fs'),
byline = require('byline'),
_ = require('lodash'),
through2 = require('through2');

var collections = require('gramene-mongodb-config');
var comparaDatabase = require('../ensembl_db_info.json').compara.database;
var argv = require('minimist')(process.argv.slice(2));
var isGramene = true;

var reader = byline(fs.createReadStream(argv.i));
var writer = fs.createWriteStream(argv.o);
var binAdder = require('./bin_adder')({fixed:[100,200,500,1000],uniform:[1,2,5,10]});
if (isGramene) {
  var fixMaizeV4 = require('./fix_maize_v5')();
  var fixSorghumV2 = require('./fix_sorghum_v2')();
  var fixBarley = require('./fix_barley_ids')();
  var thalemine = require('./thalemine')();
  var rapdb = require('./rapdb')();
  var curated = require('./curated')();
  var generifs = require('./generifs')(3);
  var qtls = require('./addQtlXrefs')();  // interval-tree containment: union of TO terms from ALL QTLs that fully contain the gene
}
var pathwayLUT = require(argv.p);
var pathwayAdder = require('./doc_merger')(pathwayLUT);
var genetreeAdder = require('./genetree_adder')(comparaDatabase);
var homologAdder = require('./homolog_adder')();   // reads the mongo `homologs` collection
var domainArchitect = require('./domain_architect')();
var ancestorAdder = require('./ancestor_adder')();
var panZeaAdder = require('./panmaize_xrefs')();
var grassius = require('./grassius')();
var vitisSynonymAdder = require('./vitis_synonym_adder')();
var msu6Adder = require('./msu6_adder')();
var parser = through2.obj(function (line, enc, done) {
  this.push(JSON.parse(line));
  done();
});

var numberDecorated=0;
var serializer = through2.obj(function (obj, enc, done) {
  if (obj.err) {
    this.push(JSON.stringify(obj) + "\n");
  }
  numberDecorated++;
  if (numberDecorated % 1000 === 0) {
    console.error('decorated '+numberDecorated+' genes');
  }
  done();
});

var assignCanonicalTranscript = through2.obj(function (gene, enc,done ) {
  if (!gene.gene_structure.canonical_transcript) {
    var transcripts = gene.gene_structure.transcripts;
    if (transcripts.length === 1) {
      gene.gene_structure.canonical_transcript = transcripts[0].id;
    }
    else {
      var longest_translation = 0;
      var longest_transcript = 0;
      var ct;
      transcripts.forEach(function(transcript) {
        if (transcript.translation) {
          if (transcript.translation.length > longest_translation) {
            longest_translation = transcript.translation.length;
            longest_transcript = transcript.length;
            ct = transcript.id;
          }
          else if (transcript.translation.length === longest_translation && transcript.length > longest_transcript) {
            longest_transcript = transcript.length;
            ct = transcript.id;
          }
        }
        else if (transcript.length > longest_transcript) {
          longest_transcript = transcript.length;
          ct = transcript.id;
        }
      });
      gene.gene_structure.canonical_transcript = ct;
    }
  }
  this.push(gene);
  done();
});

var orderTranscripts = through2.obj(function (gene, enc, done) {
  var transcripts = gene.gene_structure.transcripts;
  if (transcripts.length > 1) {
    var ct = gene.gene_structure.canonical_transcript;
    if (transcripts[0].id !== ct) {
      var t0 = transcripts[0];
      for(var i=1; i<transcripts.length;i++) {
        if (transcripts[i].id === ct) {
          transcripts[0] = transcripts[i];
          transcripts[i] = t0;
          break;
        }
      }
    }
  }
  this.push(gene);
  done();
});

var speciesRank = {
  sorghum_bicolor : 1, // sorghum
  arabidopsis_thaliana : 4, // arabidopsis
  oryza_sativa: 3, // rice
  zea_maysb73 : 2  // maize
};
 
var speciesRanker = through2.obj(function (obj, enc, done) {
  obj.species_idx = speciesRank[obj.system_name] || obj.taxon_id; //Math.floor(obj.taxon_id/1000);
  this.push(obj);
  done();
});

var fixTranslationLength = through2.obj(function (obj, enc, done) {
  obj.gene_structure.transcripts.forEach(function(tr) {
    if (tr.translation && _.isNull(tr.translation.length)) {
      tr.translation.length = Math.floor(tr.cds.end - tr.cds.start + 1);
    }
  });
  this.push(obj);
  done();
});

var cleanup = through2.obj(function (gene, enc, done) {
  function removeEmpties(obj) {
    for (var k in obj) {
      if (obj[k] && typeof(obj[k]) === 'object') {
        if (Object.keys(obj[k]).length === 0) {
          delete obj[k];
        }
        else if (!Array.isArray(obj[k])) {
          removeEmpties(obj[k]);
        }
      }
      else if (obj[k] === '') {
        delete obj[k];
      }
    }
  }
  removeEmpties(gene);
  this.push(gene);
  done();
});

var upsertGeneIntoMongo = function upsertGeneIntoMongo(mongoCollection) {
  var transform = function (gene, enc, done) {
    var throughThis = this;
    mongoCollection.insertOne(
      gene,
      function (err, count, status) {
        throughThis.push({err: err, status: status, _id: gene._id});
        done();
      }
    );
  };

  var flush = function(done) {
    console.error('upsert to mongo is done');
    collections.closeMongoDatabase();
    console.error('closeMongoDatabase completed');
    done();
  };

  return through2.obj(transform, flush);
};

// --- stall diagnostics -------------------------------------------------------------------
// Most adders are `somePromise.then(function(lut){ ...; done(); })` with no rejection handler.
// If anything in there throws, the rejection is swallowed, done() is never called, and the whole
// pipeline silently deadlocks: the process sits idle in the event loop producing no output and no
// error. Rather than guess which stage ate the gene, count what enters each one; a watchdog prints
// the counters when progress stops, so the stage whose count exceeds the next one's is the culprit.
var taps = [];
function tap(name) {
  var t = { name: name, n: 0, last: null };
  taps.push(t);
  return through2.obj(function (gene, enc, done) {
    t.n++; t.last = gene && gene._id;
    this.push(gene);
    done();
  });
}
function reportStall(why) {
  console.error('=== DECORATE ' + why + ' — genes entering each stage (last gene seen) ===');
  for (var i = 0; i < taps.length; i++) {
    var t = taps[i], next = taps[i + 1];
    var stuck = next && (t.n - next.n) > 0 ? '   <-- ' + (t.n - next.n) + ' gene(s) went in and never came out' : '';
    console.error('  ' + String(t.n).padStart(9) + '  ' + t.name + '  last=' + t.last + stuck);
  }
  console.error('  ' + String(numberDecorated).padStart(9) + '  (written to mongo)');
}
var STALL_MS = +(process.env.DECORATE_STALL_MS || 300000);   // 5 min of no progress
var lastCount = -1, lastMove = Date.now();
setInterval(function () {
  // Don't arm until the first gene is written: building the lookup tables legitimately
  // produces no output for several minutes and must not be reported as a stall.
  if (numberDecorated === 0) { lastMove = Date.now(); return; }
  if (numberDecorated !== lastCount) { lastCount = numberDecorated; lastMove = Date.now(); return; }
  if (Date.now() - lastMove >= STALL_MS) {
    reportStall('STALLED (no gene written for ' + Math.round(STALL_MS / 1000) + 's)');
    process.exit(4);          // fail loudly instead of hanging forever
  }
}, 30000);
process.on('SIGUSR2', function () { reportStall('counters on demand'); });
// -----------------------------------------------------------------------------------------

collections.genes.mongoCollection().then(function(genesCollection) {
  var upsert = upsertGeneIntoMongo(genesCollection);
  var stream = reader.pipe(parser).pipe(tap('parser'));
  if (isGramene) {
    stream = stream.pipe(fixMaizeV4).pipe(tap('fixMaizeV4'))
      .pipe(fixSorghumV2).pipe(tap('fixSorghumV2'))
      .pipe(panZeaAdder).pipe(tap('panZeaAdder'))
      .pipe(grassius).pipe(tap('grassius'))
      .pipe(vitisSynonymAdder).pipe(tap('vitisSynonymAdder'))
      .pipe(msu6Adder).pipe(tap('msu6Adder'))
      .pipe(fixBarley).pipe(tap('fixBarley'))
      .pipe(thalemine).pipe(tap('thalemine'))
      .pipe(rapdb).pipe(tap('rapdb'))
      .pipe(curated).pipe(tap('curated'))
      .pipe(generifs).pipe(tap('generifs'))
      .pipe(qtls).pipe(tap('qtls'))
  }
  stream = stream.pipe(fixTranslationLength).pipe(tap('fixTranslationLength'))
    .pipe(assignCanonicalTranscript).pipe(tap('assignCanonicalTranscript'))
    .pipe(orderTranscripts).pipe(tap('orderTranscripts'))
    .pipe(genetreeAdder).pipe(tap('genetreeAdder'))
    .pipe(binAdder).pipe(tap('binAdder'))
    .pipe(pathwayAdder).pipe(tap('pathwayAdder'))
    .pipe(homologAdder).pipe(tap('homologAdder'))
    .pipe(domainArchitect).pipe(tap('domainArchitect'))
    .pipe(ancestorAdder).pipe(tap('ancestorAdder'))
  if (isGramene) {
    stream = stream.pipe(speciesRanker).pipe(tap('speciesRanker'));
  }
  stream = stream.pipe(cleanup).pipe(tap('cleanup'))
    .pipe(upsert)
    .pipe(serializer)
    .pipe(writer);

  writer.on('finish', function() {
    process.exit(0);
  });
});

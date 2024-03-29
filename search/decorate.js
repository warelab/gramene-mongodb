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
  var generifs = require('./generifs')(3);
  var qtls = require('./qtl_adder')();
}
var pathwayLUT = require(argv.p);
var pathwayAdder = require('./doc_merger')(pathwayLUT);
var genetreeAdder = require('./genetree_adder')(comparaDatabase);
var homologAdder = require('./homolog_adder')('9');//collections.getVersion());
var domainArchitect = require('./domain_architect')();
var ancestorAdder = require('./ancestor_adder')();
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
  3702001 : 1, // arabidopsis
  39947001: 2, // rice
  4577001 : 3, // maize
  4558001 : 4 // sorghum
};

var speciesRanker = through2.obj(function (obj, enc, done) {
  obj.species_idx = speciesRank[obj.taxon_id] || obj.taxon_id;
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

collections.genes.mongoCollection().then(function(genesCollection) {
  var upsert = upsertGeneIntoMongo(genesCollection);
  var stream = reader.pipe(parser);
  if (isGramene) {
    stream = stream.pipe(fixMaizeV4)
      .pipe(fixSorghumV2)
      .pipe(fixBarley)
      .pipe(thalemine)
      .pipe(rapdb)
      .pipe(generifs)
      .pipe(qtls)
  }
  stream = stream.pipe(fixTranslationLength)
    .pipe(assignCanonicalTranscript)
    .pipe(orderTranscripts)
    .pipe(genetreeAdder)
    .pipe(binAdder)
    .pipe(pathwayAdder)
    .pipe(homologAdder)
    .pipe(domainArchitect)
    .pipe(ancestorAdder)
  if (isGramene) {
    stream = stream.pipe(speciesRanker);
  }
  stream = stream.pipe(cleanup)
    .pipe(upsert)
    .pipe(serializer)
    .pipe(writer);

  writer.on('finish', function() {
    process.exit(0);
  });
});

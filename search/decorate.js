#!/usr/bin/env node

var fs = require('fs'),
byline = require('byline'),
_ = require('lodash'),
through2 = require('through2');

var collections = require('gramene-mongodb-config');

var argv = require('minimist')(process.argv.slice(2));

var reader = byline(fs.createReadStream(argv.i));
var writer = fs.createWriteStream(argv.o);
var binAdder = require('./bin_adder')({fixed:[100,200,500,1000],uniform:[1,2,5,10]});
var pathwayAdder = require('./pathway_adder')(argv.p);
var genetreeAdder = require('./genetree_adder')(argv.d);
var homologAdder = require('./homolog_adder')(1);
var domainArchitect = require('./domain_architect')();
var ancestorAdder = require('./ancestor_adder')();
var parser = through2.obj(function (line, enc, done) {
  this.push(JSON.parse(line));
  done();
});

var serializer = through2.obj(function (obj, enc, done) {
  if (obj.err) {
    this.push(JSON.stringify(obj) + "\n");
  }
  done();
});

var taxFix = through2.obj(function(gene,enc,done) {
  if (gene.taxon_id === 4577) {
    if (gene.system_name === "zea_mays") {
      gene.taxon_id = 45770003;
    }
    else if (gene.system_name === "zea_mays4m") {
      gene.taxon_id = 45770004;
    }
  }
  this.push(gene);
  done();
});

var rename_id = through2.obj(function (gene, enc, done) {
  if (gene.system_name === "zea_mays4m" && gene.db_type === "otherfeatures") {
    gene.synonyms = [gene._id];
    gene._id += '_projected';
  }
  this.push(gene);
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
  3702 : 1, // arabidopsis
  45770004 : 2, // maize v4
  45770003 : 3, // maize v3
  39947: 4, // rice
  4558 : 5 // sorghum
};

var speciesRanker = through2.obj(function (obj, enc, done) {
  obj.species_idx = speciesRank[obj.system_name] || obj.taxon_id;
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
    mongoCollection.update(
      {_id: gene._id},
      gene,
      {upsert: true},
      function (err, count, status) {
        throughThis.push({err: err, status: status, _id: gene._id});
        done();
      }
    );
  };

  var flush = function(done) {
    collections.closeMongoDatabase();
    console.error('upsert to mongo is done');
    done();
  };

  return through2.obj(transform, flush);
};
// var sayHi = function sayHi(mesg) {
//
//   var transform = function (gene, enc, done) {
//     console.error(mesg,gene._id);
//     this.push(gene);
//     done();
//   };
//   var flush = function(done) {
//     done();
//   };
//   return through2.obj(transform, flush);
// };

collections.genes.mongoCollection().then(function(genesCollection) {
  var upsert = upsertGeneIntoMongo(genesCollection);
  reader
  .pipe(parser)
  .pipe(rename_id) // only used this for projected zmv3 gene models so they wouldn't clash with the zmv3 models with the same _id
  .pipe(taxFix)
  .pipe(fixTranslationLength)
  .pipe(assignCanonicalTranscript)
  .pipe(orderTranscripts)
  .pipe(genetreeAdder)
  .pipe(binAdder)
  .pipe(pathwayAdder)
  .pipe(homologAdder)
  .pipe(domainArchitect)
  .pipe(ancestorAdder)
  .pipe(speciesRanker)
  .pipe(cleanup)
  .pipe(upsert)
  .pipe(serializer)
  .pipe(writer);

  writer.on('finish', () => {
    process.exit(0);
  });
});
#!/usr/bin/env node

var fs = require('fs'),
byline = require('byline'),
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

var speciesRank = {
  3702 : 1, // arabidopsis
  39947: 2, // rice
  4577 : 3, // maize
  4558 : 4  // sorghum
};

var speciesRanker = through2.obj(function (obj, enc, done) {
  obj.species_idx = speciesRank[obj.taxon_id] || obj.taxon_id;
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
    console.log('upsert to mongo is done');
    done();
  };

  return through2.obj(transform, flush);
};

collections.genes.mongoCollection().then(function(genesCollection) {
  var upsert = upsertGeneIntoMongo(genesCollection);

  reader
  .pipe(parser)
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
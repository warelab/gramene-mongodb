var sqlite3 = require('sqlite3');
var db = new sqlite3.Database(':memory:');
var fs = require('fs');
var csv = require('csv-parser');
var _ = require('lodash');
var through2 = require('through2');

/* sqlite schema

 CREATE TABLE `homologue_lut` (
 `geneId` varchar(25),
 `otherId` varchar(25),
 `kind` varchar(25), // maybe an int or short?
 `isTreeCompliant` int,
 primary key (`geneId`, `otherId`)
 );

 CREATE INDEX geneId_idx ON homologue_lut (geneId);
 CREATE INDEX otherId_idx ON homologue_lut (otherId);
 */
var data = fs.createReadStream('homologue_edge.txt').pipe(csv({separator: '\t'}));

var kinds = ['ortholog_one2one', 'ortholog_one2many', 'ortholog_many2many', 'within_species_paralog', 'other_paralog', 'gene_split', 'between_species_paralog', 'alt_allele', 'homoeolog_one2one', 'homoeolog_one2many', 'homoeolog_many2many'];
var kindsLUT = _.reduce(kinds, function (acc, v, i) {
  acc[v] = i;
  return acc;
}, {});

db.serialize(function () {
  db.run(
    'CREATE TABLE `homologue_lut` (' +
    '`geneId` varchar(40),' +
    '`otherId` varchar(40),' +
    '`kind` integer, ' +
    '`isTreeCompliant` integer,' +

    'primary key (`geneId`, `otherId`)' +
    ');'
  );

  console.log('indices...');
  db.run('CREATE INDEX geneId_idx ON homologue_lut (geneId);');
  db.run('CREATE INDEX otherId_idx ON homologue_lut (otherId);');

  var reformatter = through2.obj(function (homology, enc, done) {
    this.push([
      homology.geneId,
      homology.otherId,
      kindsLUT[homology.kind],
      +homology.isTreeCompliant
    ]);
    done();
  });

  var counter = function (logEvery) {
    var count = 0;

    function transform(thing, enc, done) {
      this.push(thing);
      ++count;
      if (!(count % logEvery)) {
        console.log(count + ' items processed');
      }
      done();
    }

    function flush(done) {
      console.log(count + ' total items');
      done();
    }

    return through2.obj(transform, flush);
  };

  //var batcher = function (batchSize) {
  //  if (!batchSize || batchSize < 2 || batchSize > 1000000) {
  //    throw new Error("Batch Idiot");
  //  }
  //  var batch = [];
  //
  //  function transform(thing, enc, done) {
  //    batch.push(thing);
  //    if (batch.length === batchSize) {
  //      this.push(batch);
  //      batch = [];
  //    }
  //    done();
  //  }
  //
  //  function flush(done) {
  //    this.push(batch);
  //    done();
  //  }
  //
  //  return through2.obj(transform, flush);
  //};

  var time = new Date().getTime();
  var loader = function () {
    var count = 0;

    var insert = db.prepare("INSERT INTO homologue_lut VALUES (?, ?, ?, ?)");

    function transform(vals, enc, done) {
      count++;

      var streamThis = this;
      var localCount = count;
      insert.run(vals, function (err) {
        if (!(this.lastID % 10000)) {
          var now = new Date().getTime();
          var duration = now - time;
          console.log('Count is ' + localCount + '. This 10000 inserted in ' + duration + 'ms');
          time = now;
        }
        if (err) {
          console.log('Error inserting', err);
        }
        streamThis.push(vals);
        done();
      });
    }

    function flush(done) {
      console.log('Count is ' + count);
      done();
    }

    return through2.obj(transform, flush);
  };

  var serializer = through2.obj(function (item, enc, done) {
    this.push(JSON.stringify(item) + '\n');
    done();
  }, function (done) { done(); });

  var out = fs.createWriteStream('out.out', 'utf8');

  data.pipe(reformatter)
    //.pipe(counter(10000))
    .pipe(loader())
    .pipe(serializer)
    .pipe(out);

  out.on('finish', function () {


    db.get('select count(distinct geneId) from homologue_lut', function(err, rslt) {
      console.log(err, rslt);
    })
  });
});


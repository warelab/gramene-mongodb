var mongoURL = 'mongodb://brie:27017/search46';

var MongoClient = require('mongodb').MongoClient;
var neo4j = require('neo4j');
var fs = require('fs');
var _ = require('lodash');
var Q = require('q');
var through2 = require('through2');
var byline = require('byline');
var TreeModel = require('tree-model');


var homologGraph = new neo4j.GraphDatabase('http://neo4j:its5aT3I@localhost:7474');
var cypherQuery = Q.nbind(homologGraph.cypher, homologGraph);

var batch = function batchFactory(batchSize) {
  if(!batchSize || batchSize < 2 || batchSize > 10000) {
    throw new Error("Idiot.");
  }
  var _arr = [];
  function transform(gene, enc, done) {
    _arr.push(gene);

    if(_arr.length === batchSize) {
      this.push(_arr);
      _arr = [];
    }

    done();
  }

  function flush(done) {
    if(_arr.length) {
      this.push(_arr);
    }

    done();
  }

  return through2.obj(transform, flush);
};

var unbatch = through2.obj(function unbatcher(arr, enc, done) {
  var push = this.push;
  if(arr && arr.length) {
    _.forEach(arr, function(gene) {
      push(gene);
    });
  }
  done();
});

var addHomologs = through2.obj(function getHomologs(genes) {
  var geneIds = _.map(genes, 'name');
  return cypherQuery({
    query: 'MATCH (g1:Gene)-[h:HOMOLOGY]-(g2:Gene) WHERE g1.name in {geneIds} RETURN g1.name as geneId, h.kind as kind, g2.name as homologueId',
    params: {geneIds: geneIds}
  }).then(function groupByGeneId(results) {
    return _.groupBy(results, 'geneId');
  }).then(function addHomologsToGenes(groupedResults) {
    _.forEach(genes, function(gene) {
      var homologs = groupedResults[gene.name];
      if(homologs) {
        gene.homologs = homologs.map(function removeId(homo) {
          delete homo['geneId'];
        });
      }
    });
  });
});

var filename = process.argv[2];

// do all the one-time async stuff
MongoClient.connect(mongoURL, function (err, db) {
  var toJson = through2.obj(function (line, enc, done) {
    this.push(JSON.parse(line.toString()));
    done();
  });

  var time = new Date().getTime();
  var count = 0;

  var findTree = Q.nbind(db.collection('genetree').find, db.collection('genetree'));

  var addTree = through2.obj(function (gene, enc, done) {
    var newTime = new Date().getTime();
    if (++count && (newTime - time) > 5000) {
      console.log(count);
      time = newTime;
    }

    var streamThis = this;
    if (gene.grm_gene_tree) {
      findTree({_id: gene.grm_gene_tree}).then(function (rawTree) {
        gene._tree = new TreeModel().parse(rawTree);
        streamThis.push(gene);
        done();
      }).catch(function (err) {
        console.error(err);
        done();
      });
    }
    else {
      streamThis.push(gene);
      done();
    }
  });

  var fromJson = through2.obj(function (gene, enc, done) {
    this.push(JSON.stringify(gene) + '\n');
    done();
  });

  fs.createReadStream(filename, {encoding: 'utf8'})
    .pipe(byline.createStream())
    .pipe(toJson)
    .pipe(addTree)
    .pipe(batch(100))
    .pipe(addHomologs)
    .pipe(unbatch)
    .pipe(fromJson)
    .pipe(fs.createWriteStream(filename.replace(/json$/, 'out.json'), {encoding: 'utf8'}));

});
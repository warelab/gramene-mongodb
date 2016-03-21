var mysql = require('mysql');
var TreeModel = require('tree-model');
function childNodeComparator(a, b) {
  return a.left_index < b.left_index ? 1 : -1;
}

var treeModel = new TreeModel({modelComparatorFn:childNodeComparator});
var FlatToNested = require('flat-to-nested');
var _ = require('lodash');
var through2 = require('through2');
var fs = require('fs');
//var MongoClient = require('mongodb').MongoClient;
var collections = require('gramene-mongodb-config');
var argv = require('minimist')(process.argv.slice(2));

var comparaMysqlDb = mysql.createConnection({
  "host": argv.h,
  "user": argv.u,
  "password": argv.p,
  "database": argv.d
});

// this query returns one row per node in the tree; it includes both leaf and
// branch nodes. some properties (e.g. system_name) are null for branch nodes
// and others (e.g. node_type) are null for leaf nodes.

// a good deal of this 'rootRoot' and 'case' stuff is necessary to reassemble the
// full gene-trees from the split sibling trees that Ensembl generates to keep
// their sizes down.
var query = "select r.root_id,\n"
+ "n.node_id,n.distance_to_parent,n.left_index,n.right_index,\n"
+ "case when n.node_id = n.root_id\n"
+ "	then null\n"
+ "	else n.parent_id\n"
+ "end as parent_id,\n"
+ "n.node_name as taxon_name,n.taxon_id,\n"
+ "gd.name as system_name,\n"
+ "ntn.name as synonym\n"
+ "from species_tree_root r\n"
+ "	inner join species_tree_node n on n.root_id = r.root_id\n"
+ "	left join genome_db gd on gd.genome_db_id = n.genome_db_id\n"
+ " inner join ncbi_taxa_name ntn on ntn.taxon_id = n.taxon_id\n"
+ "where ntn.name_class != \"merged_taxon_id\"\n"
+ "order by r.root_id, n.left_index\n";

console.error(query);

var queryStream = comparaMysqlDb.query(query).stream({highWaterMark: 5});

var tidyRow = through2.obj(function (row, encoding, done) {
  // remove null properties
  this.push(_.omitBy(row, _.isNull));
  done();
});

var convertBuffersToStrings = through2.obj(function (row, encoding, done) {
  for (var f in row) {
    if (typeof(row[f]) === "object") {
      row[f] = row[f].toString();
    }
  }
  this.push(row);
  done();
});

var groupSynonyms = (function() {
  var growingNode;
  
  var transform = function (row, enc, done) {
    if (growingNode && growingNode.node_id === row.node_id) {
      growingNode.synonyms.push(row.synonym);
    }
    else {
      var doneNode = growingNode;
      growingNode = row;
      growingNode.synonyms = [growingNode.synonym];
      delete growingNode.synonym;

      if (doneNode) {
        doneNode.synonyms = _.uniq(doneNode.synonyms);
        this.push(doneNode);
      }
    }
    done();
  };
  
  var flush = function(done) {
    this.push(growingNode);
    done();
  };
  
  return through2.obj(transform, flush);
})();

var groupRowsByTree = (function () {
  var growingTree;

  var transform = function (row, enc, done) {
    if (growingTree && growingTree.tree_root_id === row.root_id) {
      growingTree.nodes.push(row);
    }
    else {
      var doneTree = growingTree;
      growingTree = {
        tree_root_id: row.root_id,
        tree_type: row.tree_type,
        nodes: [row]
      };

      if (doneTree) {
        this.push(doneTree);
      }
    }

    if (row.node_id !== row.root_id) {
      // remove tree-specific properties that we capture at the root level of growingTree
      delete row.root_id;
      delete row.tree_type;
    }

    done();
  };

  var flush = function (done) {
    //console.log('group rows by tree is done');
    this.push(growingTree);
    done();
  };

  return through2.obj(transform, flush);
})();

var makeNestedTree = through2.obj(function (tree, enc, done) {
  tree.nested = new FlatToNested({id: 'node_id', parent: 'parent_id', children: 'children'}).convert(tree.nodes);
  tree.nested._id = tree.tree_root_id;
  this.push(tree);
  done();
});

var loadIntoTreeModelAndDoAQuickSanityCheck = through2.obj(function (tree, enc, done) {
  var count = 0;
  tree.treeModel = treeModel.parse(tree.nested);
  tree.treeModel.walk(function (node) {
    ++count;
    if (node.children && node.children.length) {
      if (node.model.gene_stable_id) {
        console.log('Found branch node associated with a gene', node.model.gene_stable_id, node.model.node_id);
      }
      if (node.children.length === 1) {
        console.log('Found node with exactly one child. This is probably super-sub tree junction.',
          tree.tree_type,
          node.model.node_id)
      }
    }
    else {
      if(node.model.node_type) {
        console.log('Found leaf node with property meant for branch node', node.model.node_type, node.model.node_id);
      }
    }
  }.bind(this));

  if(count != tree.nodes.length) {
    console.log('Expected ' + tree.nodes.length + ' nodes in treemodel, but found ' + count);
  }
  this.push(tree);
  done();
});


var counter = (function () {
  var treeCount = 0;
  var rowCount = 0;

  var transform = function (tree, enc, done) {
    ++treeCount;
    rowCount += tree.nodes.length;
    if (treeCount % 1000 == 0) {
      console.log(treeCount + ' trees with ' + rowCount + ' nodes so far');
    }
    this.push(tree);
    done();
  };

  var flush = function (done) {
    console.log(treeCount + ' trees with ' + rowCount + ' nodes in total');
    done();
  };

  return through2.obj(transform, flush);
})();

var addMapsInfo = function addMapsInfo(mapsLUT) {
  var transform = function (tree, enc, done) {
    function countGenes(node) {
      if (mapsLUT.hasOwnProperty(node.model.taxon_id)) {
        node.model.num_genes = mapsLUT[node.model.taxon_id].num_genes;
      }
      else {
        node.model.num_genes = 0;
        node.children.forEach(function(child) {
          if (!child.model.hasOwnProperty('num_genes')) {
            countGenes(child);
          }
          node.model.num_genes += child.model.num_genes;
        });
      }
    }
    
    countGenes(tree.treeModel);

    this.push(tree);
    done();
  };
  var flush = function (done) {
    done();
  };
  return through2.obj(transform, flush);
};

var upsertTreeIntoMongo = function upsertTreeIntoMongo(mongoCollection) {
  var transform = function (tree, enc, done) {
    var throughThis = this;
    tree.nested.compara_db = argv.d; // so we can pull out just the gene trees we want later
    mongoCollection.update(
      {_id: tree.nested._id},
      tree.nested,
      {upsert: true},
      function (err, count, status) {
        throughThis.push({err: err, status: status, _id: tree.nested._id});
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

var serialize = through2.obj(function (r, enc, done) {
  this.push(JSON.stringify(r) + "\n");
  done();
}, function (done) {
  console.log('serializer is done');
  done();
});

var fileWriter = fs.createWriteStream('./inserts.jsonl');

collections.maps.mongoCollection().then(function(mapsCollection) {
  mapsCollection.find({type: 'genome'}, {}).toArray(function (err, genomes) {
    if (err) throw err;
    var mapLUT = {};
    genomes.forEach(function(g) {
      mapLUT[g.taxon_id] = g;
    });
    collections.speciestrees.mongoCollection().then(function(mongoCollection) {
      var upsert = upsertTreeIntoMongo(mongoCollection);

      queryStream
        .pipe(tidyRow)
        .pipe(convertBuffersToStrings)
        .pipe(groupSynonyms)
        .pipe(groupRowsByTree)
        .pipe(makeNestedTree)
        .pipe(loadIntoTreeModelAndDoAQuickSanityCheck)
        .pipe(addMapsInfo(mapLUT))
        .pipe(counter)
        .pipe(upsert)
        .pipe(serialize)
        .pipe(fileWriter);

      fileWriter.on('finish', function () {
        comparaMysqlDb.end(function(err) {
          console.log('mysql conn closed');
        });

        console.log('We are done here.');

        // it would be super if this were not necessary.
        process.exit(0);
      });
    });
  });
})

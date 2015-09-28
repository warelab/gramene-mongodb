var mysql = require('mysql');
var TreeModel = require('tree-model');
var treeModel = new TreeModel();
var FlatToNested = require('flat-to-nested');
var _ = require('lodash');
var through2 = require('through2');
var fs = require('fs');
var MongoClient = require('mongodb').MongoClient;

var comparaMysqlDb = mysql.createConnection({
  "host": "cabot",
  "user": "gramene_web",
  "password": "gram3n3",
  "database": "ensembl_compara_plants_46_80"
});

// this query returns one row per node in the tree; it includes both leaf and
// branch nodes. some properties (e.g. system_name) are null for branch nodes
// and others (e.g. node_type) are null for leaf nodes.
var query = "select " +
  "n.node_id, " +
  "case " +
  " when rootRoot.root_id is not null then rootRoot.root_id " +
  " else r.root_id " +
  "end " +
  "as root_id, " +

  "case " +
  " when r.root_id = n.node_id and rootRoot.root_id is null then null " +
  " else n.parent_id " +
  "end " +
  "as parent_id, " +

  "case " +
  " when rootRoot.tree_type is not null then concat('__EPlSupertree', lpad(rootRoot.root_id, 6, '0')) " + // if the tree is part of a supertree then use the supertree id " +
  " when r.stable_id is null then concat('__EPlSupertree', lpad(r.root_id, 6, '0')) " + //if it's a supertree use that id " +
  " else r.stable_id " + // otherwise the tree
  "end " +
  "as tree_id, " +

  "r.stable_id as tree_stable_id, " +

  "case " +
  " when r.root_id = n.node_id and rootRoot.tree_type = 'supertree' then r.stable_id " +
  " else NULL " +
  "end " +
  " as subtree_stable_id, " +

  "case when r.tree_type = 'supertree' or rootRoot.tree_type = 'supertree' then 'supertree' else r.tree_type end as tree_type, " +
  "n.distance_to_parent, " +
  "s.stable_id as protein_stable_id, " +
  "gene.stable_id as gene_stable_id, " +
  "g.taxon_id, " +
  "g.name as system_name, " +
  "g.assembly, " +
  "a.node_type, " +
  "a.bootstrap, " +
  "a.duplication_confidence_score, " +
  "sn.taxon_id as node_taxon_id, " +
  "sn.node_name as node_taxon " +

  "from gene_tree_root r " +
  "inner join gene_tree_node n on n.root_id = r.root_id " +

  "left join seq_member s on s.seq_member_id = n.seq_member_id " +
  "left join gene_member gene on s.gene_member_id = gene.gene_member_id " +
  "left join genome_db g on g.genome_db_id = s.genome_db_id " +

  "left join gene_tree_node_attr a on a.node_id = n.node_id " +
  "left join species_tree_node sn on sn.node_id = a.species_tree_node_id " +

  "left join gene_tree_node rootNode on rootNode.node_id = n.root_id " +
  "left join gene_tree_node rootParentNode on rootNode.parent_id = rootParentNode.node_id " +
  "left join gene_tree_root rootRoot on rootRoot.root_id = rootParentNode.`root_id` and rootRoot.tree_type = 'supertree' " +

  "where r.tree_type <> 'clusterset' and r.clusterset_id = 'default' " +
  "order by tree_id, n.node_id ";

var tidyRow = through2.obj(function (row, encoding, done) {
  // remove null properties
  this.push(_.omit(row, _.isNull));
  done();
});

var groupRowsByTree = function () {
  var growingTree;

  var transform = function (row, enc, done) {
    if (growingTree && growingTree.treeId === row.tree_id) {
      growingTree.nodes.push(row);

      if( row.tree_stable_id &&
          !_.includes(growingTree.stableIds, row.tree_stable_id)
      ) {
        growingTree.stableIds.push(row.tree_stable_id);
      }
    }
    else {
      var doneTree = growingTree;
      growingTree = {
        treeId: row.tree_id,
        treeRootId: row.root_id,
        treeType: row.tree_type,
        nodes: [row]
      };

      growingTree.stableIds = row.tree_stable_id ? [row.tree_stable_id] : [];

      if (doneTree) {
        this.push(doneTree);
      }
    }

    if (row.node_id !== row.root_id) {
      // remove tree-specific properties that we capture at the root level of growingTree
      delete row.root_id;
      delete row.tree_id;
      delete row.tree_type;
      delete row.tree_stable_id;
    }

    done();
  };

  var flush = function (done) {
    //console.log('group rows by tree is done');
    this.push(growingTree);
    done();
  };

  return through2.obj(transform, flush);
};

var makeNestedTree = through2.obj(function (tree, enc, done) {
  tree.nested = new FlatToNested({id: 'node_id', parent: 'parent_id', children: 'children'}).convert(tree.nodes);
  tree.nested._id = tree.nested.tree_id;
  tree.nested.stableIds = tree.stableIds;
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
          tree.treeType === 'supertree',
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

var counter = function () {
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
};

var serialize = through2.obj(function (r, enc, done) {
  this.push(JSON.stringify(r) + "\n");
  done();
}, function (done) {
  console.log('serializer is done');
  done()
});

var fileWriter = fs.createWriteStream('./inserts.jsonl');

MongoClient.connect('mongodb://brie:27017/search46', function (err, mongoDb) {
  var mongoCollection = mongoDb.collection('genetree');

  var upsertTreeIntoMongo = through2.obj(function (tree, enc, done) {
    var throughThis = this;
    mongoCollection.update(
      {_id: tree.nested._id},
      tree.nested,
      {upsert: true},
      function (err, count, status) {
        throughThis.push({err: err, status: status, _id: tree.nested._id});
        done();
      }
    );
  });

  var stream = comparaMysqlDb.query(query)
    .stream({highWaterMark: 5})
    .pipe(tidyRow)
    .pipe(groupRowsByTree())
    .pipe(makeNestedTree)
    .pipe(loadIntoTreeModelAndDoAQuickSanityCheck)
    .pipe(counter())
    .pipe(upsertTreeIntoMongo)
    .pipe(serialize)
    .pipe(fileWriter);

  fileWriter.on('finish', function () {
    console.log('We are done here.');
    stream.end();

    // it would be super if this were not necessary.
    process.exit(0);
  });
});
var mysql = require('mysql');
var TreeModel = require('tree-model');
var treeModel = new TreeModel();
var FlatToNested = require('flat-to-nested');
var _ = require('lodash');
var through2 = require('through2');
var fs = require('fs');

var comparaDb = mysql.createConnection({
  "host": "cabot",
  "user": "gramene_web",
  "password": "gram3n3",
  "database": "ensembl_compara_plants_45_79"
});

// this query returns one row per node in the tree; it includes both leaf and
// branch nodes. some properties (e.g. system_name) are null for branch nodes
// and others (e.g. node_type) are null for leaf nodes.
var query = "select r.stable_id as tree_id, n.node_id, n.parent_id, n.root_id, " +
  "n.distance_to_parent, s.stable_id, g.taxon_id, g.name as system_name, " +
  "g.assembly, a.node_type, a.bootstrap, a.duplication_confidence_score, " +
  "sn.taxon_id as node_taxon_id, sn.node_name as node_taxon " +

"from gene_tree_root r " +
"inner join gene_tree_node n on n.root_id = r.root_id " +

"left join seq_member s on s.seq_member_id = n.seq_member_id " +
"left join genome_db g on g.genome_db_id = s.genome_db_id " +

"left join gene_tree_node_attr a on a.node_id = n.node_id " +
"left join species_tree_node sn on sn.node_id = a.species_tree_node_id " +

"where r.tree_type = 'tree' and clusterset_id = 'default' " +

"order by r.root_id";

var tidyRow = through2.obj(function(row, encoding, done) {
  // FlatToNested does not like it if parent is defined on root.
  if(row.root_id === row.node_id) {
    row.supertree_id = row.parent_id;
    delete row.parent_id;
  }

  // remove null properties
  this.push( _.omit(row, _.isNull));
  done();
});

var groupRowsByTree = function() {
  var growingTree;

  var transform = function(row, enc, done) {
    if(growingTree && growingTree.treeId === row.tree_id) {
      growingTree.nodes.push(row);
    }
    else {
      var doneTree = growingTree;
      growingTree = {
        treeId: row.tree_id,
        nodes: [row]
      };

      if(doneTree) {
        this.push(doneTree);
      }
    }
    done();
  };

  var flush = function(done) {
    //console.log('group rows by tree is done');
    this.push(growingTree);
    done();
  };

  return through2.obj(transform, flush);
};

var makeNestedTree = through2.obj(function(tree, enc, done) {
  tree.nested = new FlatToNested({id: 'node_id', parent: 'parent_id', children: 'children'}).convert(tree.nodes);
  this.push(tree);
  done();
});

var loadIntoTreeModelAndDoAQuickSanityCheck = through2.obj(function(tree, enc, done) {
  tree.treeModel = treeModel.parse(tree.nested);
  tree.treeModel.all(function(node) {
    if(node.children && node.children.length) {
      if(node.model.stable_id) {
        console.log('Found branch node associated with a gene', node.model.stable_id, node.model.node_id);
      }
    }
    else {
      if(node.model.node_type) {
        console.log('Found leaf node with property meant for branch node', node.model.node_type, node.model.node_id);
      }
    }
  });

  this.push(tree);
  done();
});

var counter = function() {
  var treeCount = 0;
  var rowCount = 0;

  var transform = function(tree, enc, done) {
    ++treeCount;
    rowCount += tree.nodes.length;
    if(treeCount % 1000 == 0) {
      console.log(treeCount + ' trees with ' + rowCount + ' nodes so far');
    }
    this.push(tree);
    done();
  };

  var flush = function(done) {
    console.log(treeCount + ' trees with ' + rowCount + ' nodes in total');
    done();
  };

  return through2.obj(transform, flush);
};

var serialize = through2.obj(function(tree, enc, done) {
  this.push(JSON.stringify(tree.nested) + "\n");
  done();
});

var stream = comparaDb.query(query)
  .stream({highWaterMark: 5})
  .pipe(tidyRow)
  .pipe(groupRowsByTree())
  .pipe(makeNestedTree)
  .pipe(loadIntoTreeModelAndDoAQuickSanityCheck)
  .pipe(counter())
  .pipe(serialize)
  .pipe(fs.createWriteStream('./trees.json'));
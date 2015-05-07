var mysql = require('mysql');
var transform = require('stream-transform');
var TreeModel = require('tree-model');
var treeModel = new TreeModel();
var FlatToNested = require('flat-to-nested');
var _ = require('lodash');

function Grouper(options) {
  // allow use without new
  if (!(this instanceof Upper)) {
    return new Upper(options);
  }

  this.groupBy = options.groupBy || 'root_id';

  stream.Transform.call(this, options);
}


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

"where r.tree_type = 'tree' " +

"order by r.root_id";

var tidyRow = transform(function(row) {
  // FlatToNested does not like it if parent is defined on root.
  if(row.root_id === row.node_id) {
    row.supertree_id = row.parent_id;
    delete row.parent_id;
  }

  // remove null properties
  return _.omit(row, _.isNull);
});

var groupRowsByTree = function() {
  var growingTree;

  var transformer = transform(function(row) {
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
        //console.log('done with', doneTree.treeId, 'starting', growingTree.treeId);
        return doneTree;
      }
    }
  });

  transformer.on('finish', function() {
    return growingTree;
  });

  return transformer;
};

var makeNestedTree = transform(function(tree) {
  tree.nested = new FlatToNested({id: 'node_id', parent: 'parent_id', children: 'children'}).convert(tree.nodes);
  return tree;
});

var loadIntoTreeModelAndDoAQuickSanityCheck = transform(function(tree) {
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

  return tree;
});

var flatNodesFromTree = transform(function(tree) {
  // overwrite the original array
  tree.nodes = [];

  tree.treeModel.all(function(node) {
    tree.nodes.push(node);
  });

  return tree;
});

comparaDb.query(query)
  .stream()
  .pipe(tidyRow)
  .pipe(groupRowsByTree())
  .pipe(makeNestedTree)
  .pipe(loadIntoTreeModelAndDoAQuickSanityCheck)
  .pipe(flatNodesFromTree)
  .pipe(transform(function nowWhat(tree) {
    console.log('here is a tree', tree);
    return tree;
  }));
var mysql = require('mysql');
var TreeModel = require('tree-model');
var compara = require('../ensembl_db_info.json').compara;
function childNodeComparator(a, b) {
  return a.left_index < b.left_index ? 1 : -1;
}

var treeModel = new TreeModel({modelComparatorFn:childNodeComparator});
var FlatToNested = require('flat-to-nested');
var _ = require('lodash');
var through2 = require('through2');
var spigot = require('stream-spigot');
var fs = require('fs');
//var MongoClient = require('mongodb').MongoClient;
var collections = require('gramene-mongodb-config');
var comparaMysqlDb = mysql.createConnection(compara);

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
  row.taxon_name = taxonLUT[row.taxon_id] || 'unknown';
  this.push(row);
  done();
});

var groupRowsByTree = (function () {
  var growingTree;

  var transform = function (row, enc, done) {
    if (growingTree && growingTree.tree_stable_id === row.tree_stable_id) {
      growingTree.nodes.push(row);
    }
    else {
      var doneTree = growingTree;
      growingTree = {
        tree_stable_id: row.tree_stable_id,
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
      delete row.tree_stable_id;
    }

    done();
  };

  var flush = function (done) {
    this.push(growingTree);
    done();
  };

  return through2.obj(transform, flush);
})();

var makeNestedTree = through2.obj(function (tree, enc, done) {
  tree.nested = new FlatToNested({id: 'node_id', parent: 'parent_id', children: 'children'}).convert(tree.nodes);
  tree.nested._id = tree.nested.tree_stable_id;
  this.push(tree);
  done();
});

var loadIntoTreeModelAndDoAQuickSanityCheck = through2.obj(function (tree, enc, done) {
  var count = 0;
  var toDrop = [];
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
      if (node.model.left_index+1 < node.model.right_index) {
        console.log('Found a leaf node with non-adjacent left and right indexes', node.model);
        toDrop.push(node);
      }
    }
  }.bind(this));

  if(count != tree.nodes.length) {
    console.log('Expected ' + tree.nodes.length + ' nodes in treemodel, but found ' + count);
  }
  toDrop.forEach(function(node) {
    var orphan = node.drop();
    console.log('dropped problematic node',orphan.model);
  });
  this.push(tree);
  done();
});

var selectRepresentativeGeneMembers = function(haveGenome) {
  function indexTree(tree, attrs) {
    tree.indices = _.chain(attrs)
      .map(function (attr) {
        var result = {_attr: attr};
        tree.walk(function (node) {
          if (node.model.hasOwnProperty(attr)) {
            result[node.model[attr]] = node;
          }
        });
        return result;
      })
      .keyBy('_attr')
      .value();
  }
  
  function scoreRepresentative(node) {
    var desc;
    var score = 0;
    var bad = 100;
    var meh = -50;
    var good = -100;
    var modelSpeciesBonus = -25;
    if (node.model.hasOwnProperty('gene_description')) {
      score += good;
      desc = node.model.gene_description.replace(/\s*\[Source:.*/,'');
      var idRE = new RegExp(node.model.gene_stable_id+'\S*', 'i');
      desc = desc.replace(idRE,'');
      node.model.gene_description = desc;
      if (desc.match(/(projected|unknown|uncharacterized|predicted|hypothetical|putative|projected|cDNA)/i)) {
        score += bad;
      }
      else if (desc.match(/^(expressed)?\s*protein$/i)) {
        score += bad;
      }
      else if (desc.match(/^Zm0/)) {
        score += bad;
      }
      // else if (desc.match(/AT[1-5]G[0-9]{5}/i)) {
      //   if (desc.toUpperCase().match(node.model.gene_stable_id.toUpperCase())) {
      //     score -= bad;
      //   }
      //   score += bad;
      // }
      // else if (desc.match(/Os[0-9]{2}g[0-9]{7}/i)) {
      //   if (desc.toUpperCase().match(node.model.gene_stable_id.toUpperCase())) {
      //     score -= bad;
      //   }
      //   score += bad;
      // }
      else if (desc === "") {
        score += bad; // because we stripped off the only non-info there was
      }
    }
    if (node.model.hasOwnProperty('gene_display_label')) {
      score += meh;
      if (node.model.gene_display_label === node.model.gene_stable_id) {
        score -= meh;
      }
      else if (node.model.gene_display_label.match(/^POPTRDRAFT/)) {
        score -= meh;
      }
    }
    if (node.model.taxon_id === 3702) { // consider a model species bonus
      score += modelSpeciesBonus;
      if (desc && desc.match(/^Putative/)) {
        score -= bad;
      }
    }
    if (!haveGenome[node.model.taxon_id]) {
      // console.error("taxon not hosted",node.model.taxon_id);
      score += bad;
    }
    return score;
  }

  var transform = function (tree, enc, done) {
    indexTree(tree.treeModel,['gene_stable_id']);
    var leaves = tree.treeModel.indices.gene_stable_id;
    for (var id in leaves) {
      if (id !== '_attr') {
        var node = leaves[id];
        node.model.representative = {
          id: id,
          score: scoreRepresentative(node) // a lower score is better
        };
        while (node.hasOwnProperty('parent')) {
          var parent = node.parent;
          var newScore = node.model.representative.score + node.model.distance_to_parent;
          if (!parent.model.hasOwnProperty('representative')) {
            parent.model.representative = {
              id: id,
              score: newScore
            };
          }
          else {
            // parent node already has a representative.
            // check if this one is better
            if (newScore < parent.model.representative.score) {
              parent.model.representative = {
                id: id,
                score: newScore
              };
            }
            else {
              // keep the same representative, break out of the while loop
              break;
            }
          }
          node = parent;
        }
      }
    }
    this.push(tree);
    done();
  };

  var flush = function(done) {
    done();
  };

  return through2.obj(transform, flush);
}

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

var insertTreeIntoMongo = function insertTreeIntoMongo(mongoCollection) {
  var transform = function (tree, enc, done) {
    var throughThis = this;
    tree.nested.compara_db = compara.database; // so we can pull out just the gene trees we want later
    mongoCollection.insertOne(tree.nested,function (err, count, status) {
			throughThis.push({err: err, status: status, _id: tree.nested._id});
      done();
    });
  };

  var flush = function(done) {
    collections.closeMongoDatabase();
    done();
  };

  return through2.obj(transform, flush);
};

var serialize = through2.obj(function (r, enc, done) {
  this.push(JSON.stringify(r) + "\n");
  done();
}, function (done) {
  done();
});

var fileWriter = fs.createWriteStream('./inserts.jsonl');

var handleBatch = through2.obj(function (query, enc, done) {
  var that = this;
  console.error(query);
  var queryStream = comparaMysqlDb.query(query, function (err, rows, fields) {
    rows.forEach(function(r) {
      that.push(r);
    });
    done();
  });
});

var taxonLUT = {};
collections.taxonomy.mongoCollection().then(function(taxCollection) {
  taxCollection.find({subset: 'compara'}, {}).toArray(function (err, taxon) {
    if (err) throw err;
    var haveGenome = {};
    taxon.forEach(function(t) {
      taxonLUT[t._id] = t.name;
      if (_.includes(t.subset,'gramene')) {
        haveGenome[t._id] = true;
      }
    });
    collections.genetrees.mongoCollection().then(function(mongoCollection) {
      var upsert = insertTreeIntoMongo(mongoCollection);

      var queryForTreeIds = "select root_id from gene_tree_root where"
      + " tree_type='tree' and clusterset_id = 'default';";//" and stable_id IS NOT NULL;";
      comparaMysqlDb.query(queryForTreeIds, function (err, rows, fields) {
        if (err) throw err;
        var ids = rows.map(function (r) {
          return r.root_id;
        });
        console.error(`processing ${ids.length} trees`);
        var batches = [];
        var batchSize = 100;
        for(var i=0;i<ids.length;i+=batchSize) {
          var sliced = ids.slice(i,i+batchSize);
          var whereClause = `r.root_id IN (${sliced.join(',')})`;
          // this query returns one row per node in the tree; it includes both leaf and
          // branch nodes. some properties (e.g. system_name) are null for branch nodes
          // and others (e.g. node_type) are null for leaf nodes.
          var query = "select r.root_id,\n" //r.stable_id as tree_stable_id,\n"
          + "case when r.stable_id IS NULL\n"
          + " then CONCAT(\"SORGHUM6GT_\",r.root_id)\n"
          + " else r.stable_id\n"
          + "end as tree_stable_id,\n"
          + "n.node_id,n.distance_to_parent,n.left_index,n.right_index,\n"
          + "case when n.node_id = n.root_id\n"
          + "	then null\n"
          + "	else n.parent_id\n"
          + "end as parent_id,\n"
          + "sm.stable_id as protein_stable_id,\n"
          + "gene.stable_id as gene_stable_id, gene.display_label as gene_display_label, gene.description as gene_description,\n"
          + "sq.sequence,\n"
          + "gam.cigar_line as cigar,\n"
          + "case when stn.taxon_id IS NULL\n"
          + " then sm.taxon_id\n"
          + " else stn.taxon_id\n"
          + "end as taxon_id,\n"
          + "g.name as system_name,\n"
          + "a.node_type,a.bootstrap,a.duplication_confidence_score\n"
          + "from gene_tree_root r\n"
          + "	inner join gene_tree_node n on n.root_id = r.root_id\n"
          + "	left join seq_member sm on sm.seq_member_id = n.seq_member_id\n"
          + "	left join sequence sq on sm.sequence_id = sq.sequence_id\n"
          + "	left join gene_member gene on gene.gene_member_id = sm.gene_member_id\n"
          + "	left join gene_tree_node_attr a on a.node_id = n.node_id\n"
          + "	left join species_tree_node stn on stn.node_id = a.species_tree_node_id\n"
          + "	left join gene_align_member gam on gam.gene_align_id = r.gene_align_id and gam.seq_member_id = sm.seq_member_id\n"
          + "	left join genome_db g on g.genome_db_id = sm.genome_db_id\n"
          + `where ${whereClause}\n`
          + "order by r.root_id, n.left_index;";
          batches.push(query);
        }
        spigot({objectMode: true, highWaterMark: 1}, batches)
          .pipe(handleBatch)
          .pipe(tidyRow)
          .pipe(convertBuffersToStrings)
          .pipe(groupRowsByTree)
          .pipe(makeNestedTree)
          .pipe(loadIntoTreeModelAndDoAQuickSanityCheck)
          .pipe(selectRepresentativeGeneMembers(haveGenome))
          .pipe(counter)
          .pipe(upsert)
          .pipe(serialize)
          .pipe(fileWriter);
        
        fileWriter.on('finish', function () {
          comparaMysqlDb.end(function(err) {
            console.error("finished");
          });
        });
      });
    });
  });
})

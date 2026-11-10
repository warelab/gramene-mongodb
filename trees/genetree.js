var mysql = require('mysql');
var TreeModel = require('tree-model');
var compara = require('../ensembl_db_info.json').compara;

// ---- tree sets -------------------------------------------------------------
// This script builds ONE tree set per run, selected by env; 35_genetrees invokes it once per set.
// Doing it that way rather than looping internally leaves the single module-level mysql connection
// and the whole stream pipeline untouched, and gives per-set logging and resumability.
//
//   TREE_SET          the key written onto each tree doc, which genetree_adder turns into
//                     genes.homology.<TREE_SET>                      (default 'gene_tree')
//   CLUSTERSET        gene_tree_root.clusterset_id to select         (default 'default')
//   TREE_ID_PREFIX    if set, the stable_id's leading '<CLUSTERSET>_' is replaced by this, so
//                     barley_cultivars_PTHR10000_SF7 -> EplBarleyGT_PTHR10000_SF7. The family part
//                     (PANTHER/TreeFam) survives, so an id stays traceable upstream.
//   TREE_ID_ROOT_MARKER
//                     the marker between TREE_ID_PREFIX and root_id in a SYNTHETIC id
//                     (default 'root', giving EplWheatGT_root2002288464). Set it to the empty
//                     string for '<prefix><root_id>'. Its only job is to keep a synthetic id from
//                     colliding with a published one, whose suffix is always a PANTHER/TreeFam
//                     family -- so it is safe to drop ONLY where the clusterset publishes no
//                     stable_ids at all. That is the case on the rice compara
//                     (ensembl_compara_7_87_rice1025), where all 45,273 default trees are
//                     unnamed, and oryza9 accordingly served ids of the form ORYZA9GT_<root_id>.
//                     35_genetrees asserts the no-published-id precondition rather than trusting
//                     it, so if upstream ever names these trees the build fails instead of
//                     minting ambiguous ids.
//
// EVERY tree of the clusterset is taken, named or not. The cultivar clustersets hold 162,111
// trees with no stable_id beside 54,034 published ones; those unnamed trees get a synthetic
// <prefix>root<root_id> id (see the id construction below, including why such an id is not
// stable across releases). They were excluded until the 3,821,574 genes that had
// homologous_genes but no tree at all made the cost of excluding them clear.
var TREE_SET = process.env.TREE_SET || 'gene_tree';
var CLUSTERSET = process.env.CLUSTERSET || 'default';
var TREE_ID_PREFIX = process.env.TREE_ID_PREFIX || '';
// Deliberately NOT `|| 'root'`: the empty string is a meaningful value here, and `||` would
// silently turn it back into 'root'.
var TREE_ID_ROOT_MARKER = (process.env.TREE_ID_ROOT_MARKER === undefined)
  ? 'root' : process.env.TREE_ID_ROOT_MARKER;
console.error('tree set: ' + TREE_SET + '  clusterset: ' + CLUSTERSET +
              '  database: ' + compara.database +
              (TREE_ID_PREFIX ? '  id prefix: ' + TREE_ID_PREFIX : '  ids: as published') +
              (TREE_ID_PREFIX ? '  synthetic: ' + TREE_ID_PREFIX + TREE_ID_ROOT_MARKER + '<root_id>' : ''));
var isCurated = require('../curated/curated.json');
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
var shape = require('gramene-mongodb-config/tree_shape');
var comparaMysqlDb = mysql.createConnection(compara);

// NB the synthetic-id fallback is back, but derived from root_id rather than the old GT_PREFIX
// ('SB<version>GT_'), which never fired on a plants release and only logged a SorghumBase prefix.

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
  if (row.system_name && sysnameLUT[row.system_name]) {
    row.taxon_id = sysnameLUT[row.system_name]
  }
  row.taxon_name = taxonLUT[row.taxon_id] || 'unknown';
  if (row.taxon_name === 'unknown') {
    // Compara injects synthetic pan-genome taxa into its OWN ncbi_taxa_node (compara 11:
    // 45580039 "Sorghum pi536008pan", parented to 455800000 "Sorghum pan"), so an internal /
    // root species-tree node can carry a taxon id this build doesn't know. Resolve by walking
    // UP compara's parent chain to the nearest taxon we actually carry.
    //
    // The old code did Math.floor(taxon_id/1000). That happened to undo compara 10's 7-digit
    // ids, but compara's synthetic numbering is unrelated to ours, so on compara 11 it both
    // under-shoots (45580039 -> 45580, unknown here and a collision with an unrelated NCBI
    // taxon) and, for other ids, lands on a REAL but WRONG genome (45580072 is
    // sorghum_pi534133, which would become 4558007 "chinese amber"). Arithmetic can't work.
    var t = row.taxon_id, hops = 0;
    while (t !== undefined && taxonLUT[t] === undefined && hops++ < 12) {
      t = taxonParent[t];
    }
    if (t !== undefined && taxonLUT[t] !== undefined) {
      row.taxon_id = t;
      row.taxon_name = taxonLUT[t];
    }
    // else: leave the original id with 'unknown' rather than guess.
  }
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

var selectRepresentativeGeneMembers = function(haveGenome, anchorTaxa) {
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
    var nonAnchor = 25;   // hosted, but not a reference genome
    var meh = -50;
    var good = -100;
    var curated = -500;
    var modelSpeciesBonus = -25;
    if (isCurated[node.model.gene_stable_id]) {
      score += curated;
    }
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
    // Prefer a reference (anchor) genome as the tree's representative, but only mildly: a
    // non-anchor genome we host is still a perfectly good representative, whereas a taxon we
    // don't host at all cannot be shown and keeps the full penalty. Grading these apart matters
    // now that the pan-genome accessions are correctly marked in_compara — flattening them all
    // to `bad` would let any of ~70 sorghum accessions outrank the reference on a tie.
    if (!haveGenome[node.model.taxon_id]) {
      // console.error("taxon not hosted",node.model.taxon_id);
      score += bad;
    }
    else if (!anchorTaxa[node.model.taxon_id]) {
      score += nonAnchor;
    }
    return score;
  }

  var transform = function (tree, enc, done) {
    // Walk the leaf NODES, not an id-keyed index. gene_stable_id is NOT unique across the
    // genomes in this release: medicago_truncatula names all 50,739 of its genes geneNNNN, and
    // lablab_purpureus_gca030347555v1cm does the same for 24,972 of its 25,505, sharing 24,925
    // ids with it. indexTree() builds a plain map (`result[node.model[attr]] = node`), so for a
    // tree containing both genomes' copy of e.g. `gene478` only ONE leaf survived the index and
    // the other was left with no `representative` at all. genetree_adder.js then threw
    // "Cannot read properties of undefined (reading 'score')" on it and took down the whole
    // decorate -- 3 bad nodes out of 170,249 trees, found only by scanning every tree.
    //
    // The index itself is still built, unchanged, for anything that reads tree.indices; only
    // representative assignment moves off it, because that has to be per NODE: every leaf needs
    // one, whether or not another leaf happens to share its id.
    indexTree(tree.treeModel,['gene_stable_id']);
    var leafNodes = [];
    tree.treeModel.walk(function (n) {
      if ((!n.children || n.children.length === 0) && n.model.hasOwnProperty('gene_stable_id')) {
        leafNodes.push(n);
      }
    });
    leafNodes.forEach(function (leaf) {
      var id = leaf.model.gene_stable_id;
      var node = leaf;
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
    });
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

// Insert outcomes. These used to be pushed into a stream and forgotten: the transform calls
// done() whether or not the insert failed, so nothing failed the stage, and the single file the
// errors landed in was truncated on every run (see the writer below). 147 trees across the four
// cultivar sets went missing from release 70 that way -- every one rejected by the server for
// exceeding the BSON nested-object depth limit (deeper than ~112 tree levels, since each tree
// level costs two BSON levels), taking the tree membership of ~120,014 genes with them.
var insertErrors = 0;
var insertOk = 0;
var insertErrorKinds = {};

var insertTreeIntoMongo = function insertTreeIntoMongo(mongoCollection) {
  var transform = function (tree, enc, done) {
    var throughThis = this;
    tree.nested.compara_db = compara.database; // so we can pull out just the gene trees we want later
    tree.nested.tree_set = TREE_SET;           // -> genes.homology.<tree_set> in genetree_adder

    // STORE FLAT. Everything upstream of here still works on the nested form in memory, where
    // depth costs nothing; only the stored shape changes. The nested form cannot be stored at all
    // past ~112 levels -- the server rejects it for nested-object depth, which silently cost
    // release 70 its 147 deepest trees and ~120,014 genes' tree membership. fromNested is a
    // byte-exact inverse of toNested (see tree_shape.js), so /genetrees still serves what it
    // always served once the reader reconstructs.
    var doc = shape.fromNested(tree.nested);
    // Diagnostics at the top level, where they are queryable and do NOT reach the reconstructed
    // document: toNested rebuilds from nodes[0], so anything added here is dropped on the way out.
    doc.n_nodes = doc.nodes.length;
    doc.max_depth = shape.maxDepth(tree.nested);

    mongoCollection.insertOne(doc,function (err, count, status) {
        if (err) {
          insertErrors++;
          // Group by the error KIND, not the raw message. A depth rejection names the offending
          // field path in full -- 'documents.0.children.0.children.0...' repeated twice, ~2.7 KB
          // -- and the path length varies per tree, so keying on the whole message would print
          // one summary line per failing tree instead of one per reason.
          var emsg = err.message || String(err);
          var ekind = emsg.split(' in element with field name')[0].substring(0, 160);
          insertErrorKinds[ekind] = (insertErrorKinds[ekind] || 0) + 1;
          // The log keeps the full message, capped, so the field path is still there to inspect.
          throughThis.push({err: emsg.substring(0, 500), code: err.code,
                            status: status, _id: doc._id});
        }
        else {
          insertOk++;
          throughThis.push({err: null, status: status, _id: doc._id});
        }
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

// One file per tree set. './inserts.jsonl' is truncated by createWriteStream on every run and
// 35_genetrees runs this script once per set, so only the LAST set's outcomes ever survived --
// barley's 105 failures were overwritten by oat, then wheat, then rice. speciesTree.js in this
// same directory also writes './inserts.jsonl', so those two clobbered each other as well.
var INSERT_LOG = './inserts.genetree.' + TREE_SET + '.jsonl';
var fileWriter = fs.createWriteStream(INSERT_LOG);

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
var sysnameLUT = {};
var anchorTaxa = {};   // taxon_id -> true for maps entries with is_anchor
// taxon_id -> parent_id, for the species tree's taxa and their ancestors. Used to resolve
// compara's synthetic pan-genome taxa up to a taxon this build carries (see the walk above).
// Scoped to the species tree + ancestor closure so we don't pull all ~1M ncbi_taxa_node rows.
var taxonParent = {};
function loadTaxonParents(done) {
  comparaMysqlDb.query(
    "select distinct n.taxon_id, n.parent_id from ncbi_taxa_node n"
    + " join species_tree_node stn on stn.taxon_id = n.taxon_id",
    function (err, rows) {
      if (err) throw err;
      rows.forEach(function (r) { taxonParent[r.taxon_id] = r.parent_id; });
      (function closure(depth) {
        if (depth > 8) return done();
        var need = {};
        Object.keys(taxonParent).forEach(function (k) {
          var p = taxonParent[k];
          if (p && taxonLUT[p] === undefined && taxonParent[p] === undefined) need[p] = 1;
        });
        var ids = Object.keys(need);
        if (!ids.length) return done();
        comparaMysqlDb.query(
          "select taxon_id, parent_id from ncbi_taxa_node where taxon_id in (" + ids.join(',') + ")",
          function (err2, rows2) {
            if (err2) throw err2;
            if (!rows2.length) return done();
            rows2.forEach(function (r) { taxonParent[r.taxon_id] = r.parent_id; });
            closure(depth + 1);
          });
      })(0);
    });
}
collections.maps.mongoCollection().then(function(mapsCollection) {
  mapsCollection.find().toArray(function (err, maps) {
    if (err) throw err;
    maps.forEach(function(m) {
      sysnameLUT[m.system_name] = m.taxon_id
      // reference genomes: preferred as tree representatives (see scoreRepresentative)
      if (m.is_anchor) anchorTaxa[m.taxon_id] = true;
    })
    console.error("anchor genomes: " + Object.keys(anchorTaxa).length);
    collections.taxonomy.mongoCollection().then(function(taxCollection) {
      taxCollection.find({subset: 'compara'}, {}).toArray(function (err, taxon) {
        if (err) throw err;
        var haveGenome = {};
        taxon.forEach(function(t) {
          // if (t.rank === "genome") {
          //   t._id = Math.floor(t._id / 1000);
          // }
          taxonLUT[t._id] = t.name;
          if (_.includes(t.subset,'gramene')) {
            haveGenome[t._id] = true;
          }
        });
        loadTaxonParents(function () {
        console.error("taxonParent links loaded: " + Object.keys(taxonParent).length);
        collections.genetrees.mongoCollection().then(function(mongoCollection) {
          var upsert = insertTreeIntoMongo(mongoCollection);

          // EVERY tree of this clusterset, named or not. The old `stable_id IS NOT NULL` filter
          // dropped 162,111 cultivar trees, and with them the tree membership of 3,821,574 genes
          // that still carried homologous_genes (which comes from homology_member and never
          // depended on stable_id) -- so the site showed homologs with no tree to open. The
          // "unnamed means small fragment" assumption behind that filter holds on average but
          // fails badly in the tail: 1,615 of the unnamed trees have 250+ leaves and average
          // 1,056, e.g. wheat_cultivars root 2002288464 with 1,235 leaves over 4 taxa.
          var queryForTreeIds = "select root_id from gene_tree_root where"
          + " tree_type='tree' and clusterset_id = " + comparaMysqlDb.escape(CLUSTERSET) + ";";
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
              // The tree id. stable_id is guaranteed non-null by the root selection above, so the
              // old GT_PREFIX fallback for NULL ids is gone rather than left as dead code with a
              // stale prefix. Where TREE_ID_PREFIX is set, the leading '<clusterset>_' is swapped
              // for it -- guarded by a LIKE so an id that does NOT carry that prefix is passed
              // through untouched instead of being silently truncated by SUBSTRING.
              // An unnamed tree gets a synthetic id: <prefix>root<root_id>, e.g.
              // EplWheatGT_root2002288464. The 'root' marker cannot collide with a published id,
              // whose suffix is always a PANTHER/TreeFam family (PTHR10000_SF7, TF105094).
              //
              // CAVEAT, and the reason the ids are marked this way: gene_tree_root.root_id is NOT
              // stable across compara releases, so these ids churn between releases while the
              // family-based ones do not. A bookmarked synthetic tree URL can therefore break at
              // the next release. tidyRow drops null properties, so leaving the id null is not an
              // option either -- the tree would load with a generated ObjectId and be unreachable
              // by id.
              + (TREE_ID_PREFIX
                  ? "case when r.stable_id IS NULL\n"
                    + " then CONCAT(" + comparaMysqlDb.escape(TREE_ID_PREFIX + TREE_ID_ROOT_MARKER) + ", r.root_id)\n"
                    + " when r.stable_id LIKE " + comparaMysqlDb.escape(CLUSTERSET + '\\_%') + "\n"
                    + " then CONCAT(" + comparaMysqlDb.escape(TREE_ID_PREFIX)
                    + ", SUBSTRING(r.stable_id, " + (CLUSTERSET.length + 2) + "))\n"
                    + " else r.stable_id\n"
                    + "end as tree_stable_id,\n"
                  : "case when r.stable_id IS NULL\n"
                    + " then CONCAT(" + comparaMysqlDb.escape(CLUSTERSET + '_root') + ", r.root_id)\n"
                    + " else r.stable_id\n"
                    + "end as tree_stable_id,\n")
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
              .pipe(selectRepresentativeGeneMembers(haveGenome, anchorTaxa))
              .pipe(counter)
              .pipe(upsert)
              .pipe(serialize)
              .pipe(fileWriter);
        
            fileWriter.on('finish', function () {
              comparaMysqlDb.end(function(err) {
                console.error('inserted ' + insertOk + ' trees into set ' + TREE_SET
                              + '; ' + insertErrors + ' failed (log: ' + INSERT_LOG + ')');
                if (insertErrors) {
                  Object.keys(insertErrorKinds).forEach(function (kind) {
                    console.error('  ' + insertErrorKinds[kind] + ' x ' + kind);
                  });
                  console.error('FAILED: ' + insertErrors + ' tree(s) not stored for set '
                                + TREE_SET + '. A tree rejected for nested-object depth cannot be'
                                + ' stored in the nested shape at all, however often it is retried.');
                  process.exitCode = 1;
                }
                console.error('finished');
              });
            });
          });
        });
        }); // loadTaxonParents
      });
    });
  })
})

// tree_shape.js — convert a gene tree between the NESTED form (children arrays) and the FLAT
// form (one array of nodes, each naming its parent).
//
// WHY A FLAT FORM
// MongoDB rejects a document nested deeper than ~112 tree levels, because each tree level costs
// two BSON levels (a `children` array plus the child object inside it), with
// "BSONObj exceeds maximum nested object depth". 147 trees in release 70 were rejected that way
// -- taking the tree membership of about 120,014 genes with them -- and depth has nothing to do
// with size: a rejected 1,485-leaf barley tree is 136 levels deep while a stored 1,498-leaf one
// is 65. No amount of retrying or trimming helps; the shape itself cannot hold a deep tree.
// A flat array is depth 2 no matter how deep the tree is.
//
// EXACT INVERTIBILITY IS THE WHOLE POINT
// The /genetrees endpoint returns the stored document verbatim, so the nested form is the API
// contract. fromNested() and toNested() are therefore written as exact inverses, and
// roundTripDiff() exists so a build gate can prove it over real trees rather than trust it.
//
// SHAPE
//   nested: { _id, compara_db, tree_set, node_id, ..., children: [ {node_id, ..., children: []} ] }
//   flat:   { _id, compara_db, tree_set, nodes: [ {node_id, ..., parent_id}, ... ] }
//
// nodes[0] is the ROOT node carrying every field the root has today, including the
// document-level ones. _id, compara_db and tree_set are repeated at the top level because they
// are what the collection is queried and indexed on (_id, compara_db_1, tree_set_1) -- no query
// anywhere reaches into the node structure, which is what makes this change possible at all.
//
// Node order is pre-order depth-first, so a parent always precedes its children and siblings keep
// their original order. toNested() relies on exactly that and on nothing else.
'use strict';

var TOP_LEVEL = ['_id', 'compara_db', 'tree_set'];

function fromNested(doc) {
  var nodes = [];
  (function visit(node, parentId) {
    var flat = {};
    Object.keys(node).forEach(function (k) {
      // Keep `children` as a null PLACEHOLDER rather than dropping it, so the key keeps its
      // position among the node's keys. toNested then assigns into that existing slot and the
      // rebuilt document is byte-identical to the original, not merely deep-equal -- worth one
      // null per internal node, because the nested document is the /genetrees response itself.
      flat[k] = (k === 'children') ? null : node[k];
    });
    flat.parent_id = parentId;          // null on the root
    nodes.push(flat);
    var kids = node.children || [];
    for (var i = 0; i < kids.length; i++) { visit(kids[i], node.node_id); }
  })(doc, null);

  var out = {};
  TOP_LEVEL.forEach(function (k) { if (doc[k] !== undefined) { out[k] = doc[k]; } });
  out.nodes = nodes;
  return out;
}

function toNested(flat) {
  var nodes = flat.nodes || [];
  if (!nodes.length) { throw new Error('tree_shape: no nodes in ' + flat._id); }

  // Rebuild each node without parent_id, and index by node_id. node_id is unique within a tree
  // (it is compara's gene_tree_node primary key), unlike gene_stable_id, which is NOT -- two
  // leaves in one tree can share a gene id, which is why the builder's representative index
  // keyed on gene_stable_id used to lose nodes.
  var byId = new Map();
  var rebuilt = new Array(nodes.length);
  for (var i = 0; i < nodes.length; i++) {
    var src = nodes[i], node = {};
    Object.keys(src).forEach(function (k) {
      if (k !== 'parent_id') { node[k] = src[k]; }
    });
    rebuilt[i] = node;
    byId.set(src.node_id, node);
  }

  // Attach in input order, so siblings come out in the order they went in.
  var root = null;
  for (var j = 0; j < nodes.length; j++) {
    var pid = nodes[j].parent_id;
    if (pid === null || pid === undefined) {
      if (root) { throw new Error('tree_shape: more than one root in ' + flat._id); }
      root = rebuilt[j];
      continue;
    }
    var parent = byId.get(pid);
    if (!parent) { throw new Error('tree_shape: node ' + nodes[j].node_id + ' names missing parent ' + pid + ' in ' + flat._id); }
    // Assigning into the placeholder key preserves its original position. A node that had no
    // `children` key gets one appended, which only happens for shapes fromNested never produced.
    if (!parent.children) { parent.children = []; }
    parent.children.push(rebuilt[j]);
  }
  if (!root) { throw new Error('tree_shape: no root node in ' + flat._id); }
  // A placeholder that never received children means the node is a leaf; the original had no
  // `children` key there, so drop it rather than leave a null behind.
  for (var k = 0; k < rebuilt.length; k++) {
    if (rebuilt[k].children === null) { delete rebuilt[k].children; }
  }
  return root;
}

// Deep comparison used by the build gate. Returns null when equal, else a short description of
// the first difference found. Values, array order, and the presence or absence of every key are
// compared. Key order is not compared here, but the placeholder trick above makes the round trip
// byte-identical anyway, so a gate can assert the stronger JSON-string equality on top of this.
function roundTripDiff(original) {
  function cmp(a, b, path) {
    if (a === b) { return null; }
    if (a === null || b === null || typeof a !== typeof b) {
      return path + ': ' + JSON.stringify(a) + ' vs ' + JSON.stringify(b);
    }
    if (typeof a !== 'object') {
      // NaN never equals itself; treat two NaNs as the same value.
      if (typeof a === 'number' && isNaN(a) && isNaN(b)) { return null; }
      return path + ': ' + JSON.stringify(a) + ' vs ' + JSON.stringify(b);
    }
    if (Array.isArray(a) !== Array.isArray(b)) { return path + ': array vs non-array'; }
    if (Array.isArray(a)) {
      if (a.length !== b.length) { return path + ': length ' + a.length + ' vs ' + b.length; }
      for (var i = 0; i < a.length; i++) {
        var d = cmp(a[i], b[i], path + '[' + i + ']');
        if (d) { return d; }
      }
      return null;
    }
    var ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    if (ka.length !== kb.length || ka.join(',') !== kb.join(',')) {
      return path + ': keys [' + ka.join(',') + '] vs [' + kb.join(',') + ']';
    }
    for (var n = 0; n < ka.length; n++) {
      var dd = cmp(a[ka[n]], b[ka[n]], path + '.' + ka[n]);
      if (dd) { return dd; }
    }
    return null;
  }
  return cmp(original, toNested(fromNested(original)), '$');
}

function maxDepth(nested) {
  var best = 0;
  (function visit(n, d) {
    if (d > best) { best = d; }
    var kids = n.children || [];
    for (var i = 0; i < kids.length; i++) { visit(kids[i], d + 1); }
  })(nested, 1);
  return best;
}

module.exports = { fromNested: fromNested, toNested: toNested,
                   roundTripDiff: roundTripDiff, maxDepth: maxDepth, TOP_LEVEL: TOP_LEVEL };

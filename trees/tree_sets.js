// tree_sets.js — the ONE definition of the gene-tree sets this release builds.
//
// Each entry says: the key written onto tree docs and onto genes.homology.<set>, the compara
// clusterset it comes from, and the Gramene id prefix that replaces compara's '<clusterset>_'.
//
// It lives here because this table was about to exist in a third place. 35_genetrees.sh had it,
// supertrees.js needed it, and decorate.js/redecorate.js had already shipped a bug of exactly
// that shape -- two private copies of a species-rank map that silently disagreed (see
// search/species_rank.js).
//
// Consumers today: search/supertrees.js requires this module; 35_genetrees.sh reads TREE_SETS from
// it via node. genetree.js still has its own equivalent copy of the id-rewrite SQL -- idSql() below
// exists for it to adopt next time that stage is touched. One caveat if you do: genetree.js renders
// an unnamed DEFAULT tree as `default_root<root_id>` where idSql renders `root<root_id>`. Neither
// fires (every default tree has a stable_id), but they are not identical.
//
// ID RULES, which every consumer must apply identically or ids will not join:
//   * default      -- stable_id as published (EPlGT*), no rewrite.
//   * cultivar set -- compara ships 'barley_cultivars_PTHR10000_SF7'; the leading
//                     '<clusterset>_' is replaced by `prefix`, keeping the PANTHER/TreeFam
//                     family part so an id stays traceable upstream.
//   * no stable_id -- 162,111 cultivar TREES and 651 cultivar SUBTREES under supertrees have
//                     none. They get `${prefix}root${root_id}`. The 'root' marker cannot collide
//                     with a published id, whose suffix is always a family (verified: no
//                     published stable_id in this database has a suffix beginning 'root').
//                     Caveat: root_id is NOT stable across compara releases, so these ids churn
//                     between releases while family-based ones do not.
var TREE_SETS = [
  { set: 'gene_tree', clusterset: 'default',          prefix: ''             },
  { set: 'barley',    clusterset: 'barley_cultivars', prefix: 'EplBarleyGT_' },
  { set: 'oat',       clusterset: 'oat_cultivars',    prefix: 'EplOatGT_'    },
  { set: 'wheat',     clusterset: 'wheat_cultivars',  prefix: 'EplWheatGT_'  },
  { set: 'rice',      clusterset: 'rice_cultivars',   prefix: 'EplRiceGT_'   }
];

// SQL fragment rewriting a gene_tree_root's stable_id to the id this build uses, for `alias`.
// `col` is the table alias (e.g. 'r'), `esc` a mysql escaper. Shared so the tree dump, the
// supertree map and anything later cannot drift apart on the rule above.
function idSql(col, ts, esc, allowSynthetic) {
  var parts = [];
  if (allowSynthetic) {
    parts.push(' when ' + col + '.stable_id is null then concat(' +
               esc(ts.prefix) + ", 'root', " + col + '.root_id)');
  }
  if (ts.prefix) {
    parts.push(' when ' + col + '.stable_id like ' + esc(ts.clusterset + '\\_%') +
               ' then concat(' + esc(ts.prefix) + ', substring(' + col + '.stable_id, ' +
               (ts.clusterset.length + 2) + '))');
  }
  // No WHEN clauses means nothing to rewrite (the default set, asked for published ids only).
  // Emitting `case else x end` there would be a MySQL syntax error, so return the bare column.
  if (!parts.length) { return col + '.stable_id'; }
  return 'case\n' + parts.join('\n') + '\n else ' + col + '.stable_id end';
}

module.exports = { TREE_SETS: TREE_SETS, idSql: idSql };

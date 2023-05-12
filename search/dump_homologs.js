#!/usr/bin/env node
var argv = require('minimist')(process.argv.slice(2));
var bounds = require('binary-search-bounds');
var collections = require('gramene-mongodb-config');
var compara = require('../ensembl_db_info.json').compara

const max_dist_no_overlap = 1000000;   // Max distance between genes that do not overlap
const max_nb_genes_no_overlap = 1;     // Number of genes between two genes that do not overlap
const max_dist_small_overlap = 500000; // Max distance between genes that slightly overlap
const small_overlap_percentage = 10;   // Max %ID and %pos to define a 'small' overlap
const max_nb_genes_small_overlap = 0;  // Number of genes between two genes that slightly overlap
const gene_idx_padding = 10;           // A number larger than max_nb_genes_..._overlap

// connect to mysql database
var mysql = require('mysql');
var connection = mysql.createConnection(compara);
if (!connection) throw "error";
connection.connect();
var sql0 = 'select dr.*, d.genome_db_id from dnafrag_region dr, dnafrag d'
  + ' where d.dnafrag_id = dr.dnafrag_id and dr.dnafrag_end - dr.dnafrag_start < 10000000'
  + ' order by dr.synteny_region_id, d.genome_db_id desc';

var sql1 = 'select'
  + ' g1.stable_id as gene_id,'
  + ' g1.gene_member_id as gene_gm_id,'
  + ' g1.genome_db_id as gene_genome_db_id,'
  + ' g1.dnafrag_id as gene_dnafrag_id,'
  + ' g1.dnafrag_start as gene_dnafrag_start,'
  + ' g1.dnafrag_end as gene_dnafrag_end,'
  + ' g1.dnafrag_strand as gene_dnafrag_strand,'
  + ' g2.stable_id as other_id,'
  + ' g2.gene_member_id as other_gm_id,'
  + ' g2.genome_db_id as other_genome_db_id,'
  + ' g2.dnafrag_id as other_dnafrag_id,'
  + ' g2.dnafrag_start as other_dnafrag_start,'
  + ' g2.dnafrag_end as other_dnafrag_end,'
  + ' g2.dnafrag_strand as other_dnafrag_strand,'
  + ' h.description as kind,'
  + ' h.is_tree_compliant as is_tree_compliant,'
  + ' hm.perc_pos as gene_ppos,'
  + ' hm2.perc_pos as other_ppos'
  + ' from homology h'
  + ' inner join homology_member hm on hm.homology_id = h.homology_id'
  + ' inner join gene_member g1 on hm.gene_member_id = g1.gene_member_id'
  + ' inner join homology_member hm2 on hm2.homology_id = h.homology_id and hm.gene_member_id > hm2.gene_member_id'
  + ' inner join gene_member g2 on hm2.gene_member_id = g2.gene_member_id'
  + ' inner join gene_tree_root gtr on h.gene_tree_root_id = gtr.root_id'
  + ' where gtr.tree_type = "tree" and gtr.clusterset_id = "default"';//' and gtr.stable_id IS NOT NULL';
  // + ' where g1.taxon_id NOT IN (6239,7227,9606,51511,559292)'
  // + ' and g2.taxon_id NOT IN (6239,7227,9606,51511,559292);';

var sql2 = 'select'
  + ' gene_member_id, dnafrag_id, dnafrag_strand, dnafrag_start, dnafrag_end from gene_member'
  + ' order by dnafrag_id, dnafrag_strand, dnafrag_start';

// the row is a pair of genes that are within an accepted range in the gene index (same dnafrag, strand)
function calc_gene_dist(row) {
  if (row.gene_dnafrag_start < row.other_dnafrag_start) {
    return Math.abs(row.other_dnafrag_start - row.gene_dnafrag_end); // ABS because possible overlap
  }
  else {
    return Math.abs(row.gene_dnafrag_start - row.other_dnafrag_end); // ABS because possible overlap
  }
}

function count_genes_between(row) {
  let tally = 10000; // much larger than expected
  if (row.gene_dnafrag_id === row.other_dnafrag_id && row.gene_dnafrag_strand === row.other_dnafrag_strand) {
    const key = `${row.gene_dnafrag_id}:${row.gene_dnafrag_strand}`;
    let gene_i = gene_idx[row.gene_gm_id];
    let other_i = gene_idx[row.other_gm_id];
    if (gene_i > other_i) {
      let tmp = gene_i;
      gene_i = other_i;
      other_i = tmp;
    }
    const endpoint = gene_ranges[key][other_i]['dnafrag_end'];
    tally = 0;
    while (gene_ranges[key][gene_i] && gene_ranges[key][gene_i]['dnafrag_end'] <= endpoint) {
      tally++;
      gene_i++;
    }
  }
  return tally;
}

function redisify() {
  var red = [];
  red.push('*'+arguments.length);
  Array.prototype.slice.call(arguments).forEach(function(a) {
    red.push('$'+a.length,a);
  });
  return red.join("\r\n") + "\r";
}


var previous;
var i=0;
var synteny = {};
var gene_idx = {};
var gene_ranges = {};
console.error('firing synteny query',sql0);
connection.query(sql0)
.on('error', function(err) {
  throw err;
})
.on('result', function(row) {
  if (i%2==1) {
    var interval = {
      start: row.dnafrag_start,
      end: row.dnafrag_end,
      syn: row.synteny_region_id,
      start2: previous.dnafrag_start,
      end2: previous.dnafrag_end 
    };
    synteny[row.genome_db_id] = synteny[row.genome_db_id] || {};
    synteny[row.genome_db_id][previous.genome_db_id] = synteny[row.genome_db_id][previous.genome_db_id] || {};
    synteny[row.genome_db_id][previous.genome_db_id][row.dnafrag_id] =
      synteny[row.genome_db_id][previous.genome_db_id][row.dnafrag_id] || {};
    synteny[row.genome_db_id][previous.genome_db_id][row.dnafrag_id][previous.dnafrag_id] =
      synteny[row.genome_db_id][previous.genome_db_id][row.dnafrag_id][previous.dnafrag_id] || [];

    synteny[row.genome_db_id][previous.genome_db_id][row.dnafrag_id][previous.dnafrag_id].push(interval);
  }
  else {
    previous = row;
  }
  i++;
})
.on('end', function() {
  console.error('get gene order',sql2);
  i=0;
  previous = "dnafrag_id:dnafrag_strand";
  connection.query(sql2)
  .on('error', function(err) {
    throw err;
  })
  .on('result', function (row) {
    var key = `${row.dnafrag_id}:${row.dnafrag_strand}`;
    if (key !== previous) {
      i = 0;
      gene_ranges[key] = [];
      previous = key;
    }
    gene_idx[row.gene_member_id] = i;
    gene_ranges[key].push(row);
    i++;
  })
  .on('end', function() {
    console.error('firing main query',sql1);
    // sort the intervals burried in synteny so we can do a binary search
    function compareIntervals(a,b) { return a.start - b.start };
    for (var db1 in synteny) {
      for (var db2 in synteny[db1]) {
        for (var frag1 in synteny[db1][db2]) {
          for (var frag2 in synteny[db1][db2][frag1]) {
            synteny[db1][db2][frag1][frag2].sort(compareIntervals);
          }
        }
      }
    }
    connection.query(sql1)
    .on('error', function(err) {
      // Handle error, an 'end' event will be emitted after this as well
      throw err;
    })
    .on('fields', function(fields) {
      // the field packets for the rows to follow
      console.log(redisify('SELECT','9'));//collections.getVersion()));
      console.log(redisify('FLUSHDB'));
    })
    .on('result', function(row) {
      // Pausing the connnection is useful if your processing involves I/O
      // connection.pause();
      // check if this is a split gene
      let skip = false;
      if (row.kind === 'gene_split') {
        skip = true;
        // first, check if there is small or no overlap in the MSA
        if (row.gene_ppos < small_overlap_percentage && row.other_ppos < small_overlap_percentage) {
          // and how many genes are between them on the same strand
          // let nb_genes_in_between = Math.abs(gene_idx[row.gene_gm_id] - gene_idx[row.other_gm_id]) - 1;
          const nb_genes_in_between = count_genes_between(row);
          if (row.gene_ppos === 0 && row.other_ppos === 0) {
            // no overlap
            if (nb_genes_in_between <= max_nb_genes_no_overlap + 2
              && Math.abs(row.gene_dnafrag_start - row.other_dnafrag_start) <= max_dist_no_overlap
            ) {
              skip = false;
            }
          }
          else {
            // small overlap
            if (nb_genes_in_between <= max_nb_genes_small_overlap + 2
              && Math.abs(row.gene_dnafrag_start - row.other_dnafrag_start) <= max_dist_small_overlap
              && Math.abs(row.gene_dnafrag_end - row.other_dnafrag_end) <= max_dist_small_overlap
            ) {
              skip = false;
            }
          }
        }
        else {
          // > small overlap
        }
      }
      if (row.gene_genome_db_id < row.other_genome_db_id) {
        if (
          synteny[row.gene_genome_db_id] &&
          synteny[row.gene_genome_db_id][row.other_genome_db_id] &&
          synteny[row.gene_genome_db_id][row.other_genome_db_id][row.gene_dnafrag_id] &&
          synteny[row.gene_genome_db_id][row.other_genome_db_id][row.gene_dnafrag_id][row.other_dnafrag_id]
        ) {
          var intervals = synteny[row.gene_genome_db_id][row.other_genome_db_id][row.gene_dnafrag_id][row.other_dnafrag_id];
          // check for overlap
          var le = bounds.le(intervals, {start:row.gene_dnafrag_start}, compareIntervals);
          var interval = intervals[le];
          if (interval && interval.end >= row.gene_dnafrag_end) {
            // gene is in syntenic block, what about the other gene?
            if (interval.start2 <= row.other_dnafrag_start && interval.end2 >= row.other_dnafrag_end) {
              row.kind = 'syntenic_'+row.kind;
            }
          }
        }
      }
      else if (row.gene_genome_db_id > row.other_genome_db_id) {
        if (
          synteny[row.other_genome_db_id] &&
          synteny[row.other_genome_db_id][row.gene_genome_db_id] &&
          synteny[row.other_genome_db_id][row.gene_genome_db_id][row.other_dnafrag_id] &&
          synteny[row.other_genome_db_id][row.gene_genome_db_id][row.other_dnafrag_id][row.gene_dnafrag_id]
        ) {
          var intervals = synteny[row.other_genome_db_id][row.gene_genome_db_id][row.other_dnafrag_id][row.gene_dnafrag_id];
          // check for overlap
          var le = bounds.le(intervals, {start:row.other_dnafrag_start}, compareIntervals);
          var interval = intervals[le];
          if (interval && interval.end >= row.other_dnafrag_end) {
            // gene is in syntenic block, what about the other gene?
            if (interval.start2 <= row.gene_dnafrag_start && interval.end2 >= row.gene_dnafrag_end) {
              row.kind = 'syntenic_'+row.kind;
            }
          }
        }
      }
      if (skip) {
        console.error(`skipping ${row.gene_id} ${row.other_id} ${row.kind}`);
      }
      else {
        console.log(redisify('HSET',row.gene_id, row.other_id, row.kind));
        console.log(redisify('HSET',row.other_id, row.gene_id, row.kind));
      }
      // connection.resume();
    })
    .on('end', function() {
      // all rows have been received
      console.error('all results received');
      connection.end();
    });
  })
});

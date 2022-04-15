#!/usr/bin/env node
var argv = require('minimist')(process.argv.slice(2));
var bounds = require('binary-search-bounds');
var collections = require('gramene-mongodb-config');
var compara = require('../ensembl_db_info.json').compara

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
  + ' g1.genome_db_id as gene_genome_db_id,'
  + ' g1.dnafrag_id as gene_dnafrag_id,'
  + ' g1.dnafrag_start as gene_dnafrag_start,'
  + ' g1.dnafrag_end as gene_dnafrag_end,'
  + ' g2.stable_id as other_id,'
  + ' g2.genome_db_id as other_genome_db_id,'
  + ' g2.dnafrag_id as other_dnafrag_id,'
  + ' g2.dnafrag_start as other_dnafrag_start,'
  + ' g2.dnafrag_end as other_dnafrag_end,'
  + ' h.description as kind,'
  + ' h.is_tree_compliant as is_tree_compliant'
  + ' from homology h'
  + ' inner join homology_member hm on hm.homology_id = h.homology_id'
  + ' inner join gene_member g1 on hm.gene_member_id = g1.gene_member_id'
  + ' inner join homology_member hm2 on hm2.homology_id = h.homology_id and hm.gene_member_id > hm2.gene_member_id'
  + ' inner join gene_member g2 on hm2.gene_member_id = g2.gene_member_id'
  + ' inner join gene_tree_root gtr on h.gene_tree_root_id = gtr.root_id'
  + ' where gtr.tree_type = "tree" and gtr.clusterset_id = "default"';//' and gtr.stable_id IS NOT NULL';
  // + ' where g1.taxon_id NOT IN (6239,7227,9606,51511,559292)'
  // + ' and g2.taxon_id NOT IN (6239,7227,9606,51511,559292);';

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
    console.log(redisify('SELECT','2'));//collections.getVersion()));
    console.log(redisify('FLUSHDB'));
  })
  .on('result', function(row) {
    // Pausing the connnection is useful if your processing involves I/O
    // connection.pause();
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
    console.log(redisify('HSET',row.gene_id, row.other_id, row.kind));
    console.log(redisify('HSET',row.other_id, row.gene_id, row.kind));
    // connection.resume();
  })
  .on('end', function() {
    // all rows have been received
    console.error('all results received');
    connection.end();
  });
});

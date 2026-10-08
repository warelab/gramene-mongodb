#!/usr/bin/env node
'use strict';
// build_homologs.js — build the cross-species homolog store LOCALLY from dumped compara columns,
// replacing the single giant random-access MySQL join in dump_homologs.js. That join was infeasible
// on colden's 4GB InnoDB buffer pool (275GB working set -> ~100 rows/s / days). Here we instead dump
// the few needed columns via fast SEQUENTIAL scans (dump_compara_tables.sh), then do a streaming
// merge-join of homology x homology_member on homology_id with gene_member / synteny / gene-order held
// in RAM, and write per-gene homolog records into an on-disk LMDB (dupSort) that homolog_adder.js reads
// at decorate time.
//
// Behavior matches dump_homologs.js EXACTLY: same `kind` strings (compara homology.description) with the
// optional `syntenic_` prefix, the same gene_split skip heuristic, and BOTH directions of every retained
// pair. Only the storage differs (LMDB instead of redis) and it now filters to built genomes.
//
//   node --max-old-space-size=32768 build_homologs.js [TMPDIR] | pigz > homolog_pairs.tsv.gz
//     TMPDIR default <dir>/tmp_homologs (holds the *.tsv.gz produced by dump_compara_tables.sh)
//
// Emits pairs on STDOUT: two lines per pair, "<gene_id>\t<other_id>\t<kind>" (both directions).
// Then sort by gene_id and bulk-load the LMDB sequentially (load_homolog_lmdb.js). The LMDB layout is
// dupSort: key = gene stable_id, values = "<otherStableId>\t<kind>" (one per homolog).

const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
const bounds = require('binary-search-bounds');
const collections = require('gramene-mongodb-config');

const TMP = process.argv[2] || path.join(__dirname, 'tmp_homologs');
const gz = name => path.join(TMP, name);

// ---- constants copied verbatim from dump_homologs.js ------------------------------------------------
const max_dist_no_overlap = 1000000;
const max_nb_genes_no_overlap = 1;
const max_dist_small_overlap = 500000;
const small_overlap_percentage = 10;
const max_nb_genes_small_overlap = 0;

// ---- fast line reader over a gzipped, tab-separated file (ASCII fields) ------------------------------
async function* linesOf(file) {
  const stream = fs.createReadStream(file).pipe(zlib.createGunzip());
  stream.setEncoding('utf8');
  let buf = '';
  for await (const chunk of stream) {
    buf += chunk;
    let start = 0, idx;
    while ((idx = buf.indexOf('\n', start)) >= 0) { yield buf.slice(start, idx); start = idx + 1; }
    buf = start ? buf.slice(start) : buf;
  }
  if (buf.length) yield buf;
}
const numOrNull = s => (s === '' || s === 'NULL') ? null : +s;

// =====================================================================================================
(async () => {
  const t0 = Date.now();
  const log = (...a) => console.error(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);

  // 1) gene_member: gene_member_id -> {stable_id, genome_db_id, dnafrag_id, dnafrag_start, dnafrag_end, dnafrag_strand}
  log('loading gene_member ...');
  const gm = new Map();
  for await (const line of linesOf(gz('gene_member.tsv.gz'))) {
    const c = line.split('\t');
    gm.set(+c[0], { stable_id: c[1], genome_db_id: +c[2], dnafrag_id: +c[3],
                    dnafrag_start: +c[4], dnafrag_end: +c[5], dnafrag_strand: +c[6] });
  }
  log(`gene_member: ${gm.size} members`);

  // 2) clusterset scope: include ALL clustersets that have homologies (default + the pan-genome
  //    cultivar clustersets rice/barley/wheat/oat_cultivars, tree AND supertree). The nj-*/phyml-*
  //    alt-method clustersets have NO homology rows, so "all homologies" == "all clustersets with
  //    homologies" — no root filter needed. (Original dump_homologs.js used default/tree only; that
  //    misses the pan-genome homologs, which are the bulk of the data.) The gene_tree_root_id column
  //    is still read but not filtered on.

  // 3) built genome_db_ids: maps.system_name (this build's 267 genomes) -> compara genome_db.name -> id.
  //    Excludes ~6 non-built compara genomes (outgroups/ancestral) so their homologs don't dangle.
  const mapsColl = await collections.maps.mongoCollection();
  const builtNames = new Set(await mapsColl.distinct('system_name', { type: 'genome' }));
  const builtGdb = new Set();
  for await (const line of linesOf(gz('genome_db.tsv.gz'))) {
    const c = line.split('\t');
    if (builtNames.has(c[1])) builtGdb.add(+c[0]);
  }
  log(`built genomes: ${builtNames.size} names -> ${builtGdb.size} genome_db_ids`);

  // 4) synteny structure (sql0 i%2 pairing): synteny[gdbB][gdbA][fragB][fragA] = [ {start,end,syn,start2,end2} ]
  //    dump columns: dnafrag_id, dnafrag_start, dnafrag_end, synteny_region_id, genome_db_id
  //    ordered by (synteny_region_id, genome_db_id DESC) so each region's two halves are consecutive.
  log('building synteny ...');
  const synteny = {};
  let si = 0, prev = null, synRows = 0;
  for await (const line of linesOf(gz('synteny.tsv.gz'))) {
    const c = line.split('\t');
    const row = { dnafrag_id: +c[0], dnafrag_start: +c[1], dnafrag_end: +c[2], synteny_region_id: +c[3], genome_db_id: +c[4] };
    if (si % 2 === 1) {
      const interval = { start: row.dnafrag_start, end: row.dnafrag_end, syn: row.synteny_region_id,
                         start2: prev.dnafrag_start, end2: prev.dnafrag_end };
      const a = (synteny[row.genome_db_id] ||= {});
      const b = (a[prev.genome_db_id] ||= {});
      const d = (b[row.dnafrag_id] ||= {});
      (d[prev.dnafrag_id] ||= []).push(interval);
      synRows++;
    } else prev = row;
    si++;
  }
  const compareIntervals = (a, b) => a.start - b.start;
  for (const db1 in synteny) for (const db2 in synteny[db1]) for (const f1 in synteny[db1][db2]) for (const f2 in synteny[db1][db2][f1])
    synteny[db1][db2][f1][f2].sort(compareIntervals);
  log(`synteny: ${synRows} intervals`);

  // 5) gene-order (sql2): per (dnafrag_id:dnafrag_strand) group, rank genes by dnafrag_start.
  //    gene_idx: gene_member_id -> rank; gene_ranges: key -> [dnafrag_end by rank]
  log('building gene-order ...');
  const byKey = new Map();                     // key -> [{id, start, end}]
  for (const [id, m] of gm) {
    const key = m.dnafrag_id + ':' + m.dnafrag_strand;
    let arr = byKey.get(key); if (!arr) byKey.set(key, arr = []);
    arr.push({ id, start: m.dnafrag_start, end: m.dnafrag_end });
  }
  const gene_idx = new Map();
  const gene_ranges = new Map();
  for (const [key, arr] of byKey) {
    arr.sort((a, b) => a.start - b.start);
    const ends = new Array(arr.length);
    for (let r = 0; r < arr.length; r++) { gene_idx.set(arr[r].id, r); ends[r] = arr[r].end; }
    gene_ranges.set(key, ends);
  }
  byKey.clear();
  log(`gene-order: ${gene_idx.size} genes in ${gene_ranges.size} dnafrag:strand groups`);

  function count_genes_between(row) {
    let tally = 10000;
    if (row.gene_dnafrag_id === row.other_dnafrag_id && row.gene_dnafrag_strand === row.other_dnafrag_strand) {
      const key = row.gene_dnafrag_id + ':' + row.gene_dnafrag_strand;
      let gi = gene_idx.get(row.gene_gm_id), oi = gene_idx.get(row.other_gm_id);
      if (gi > oi) { const t = gi; gi = oi; oi = t; }
      const ends = gene_ranges.get(key);
      const endpoint = ends[oi];
      tally = 0;
      while (ends[gi] !== undefined && ends[gi] <= endpoint) { tally++; gi++; }
    }
    return tally;
  }

  // 6) Emit pairs to STDOUT as a flatfile: two lines per pair, "gene_id \t other_id \t kind" (both
  //    directions). The caller pipes this to gzip, then SORTS by gene_id, then bulk-loads the LMDB
  //    sequentially (load_homolog_lmdb.js). Writing the LMDB live here thrashed the B-tree — random
  //    gene-id keys into a 30GB+ dupSort DB on a memory-tight box collapsed to ~2.5K pairs/s. A
  //    sorted bulk-load makes the LMDB inserts append-sequential (cache-friendly, fast).
  const OUT_THRESHOLD = 8 << 20;   // flush the stdout buffer at ~8MB
  let outBuf = '';
  let pairsOut = 0;
  async function flushOut() {
    if (!outBuf) return;
    const b = outBuf; outBuf = '';
    if (!process.stdout.write(b)) await new Promise(r => process.stdout.once('drain', r));
  }
  function emitPair(gene_id, other_id, kind) {
    outBuf += gene_id + '\t' + other_id + '\t' + kind + '\n' + other_id + '\t' + gene_id + '\t' + kind + '\n';
    pairsOut++;
  }

  // apply the exact sql1 result-handler logic to one directed pair, then emit
  function processPair(g1, g2, kind, ppos1, ppos2) {
    const row = {
      gene_id: g1.stable_id, gene_gm_id: g1.gm_id, gene_genome_db_id: g1.genome_db_id,
      gene_dnafrag_id: g1.dnafrag_id, gene_dnafrag_start: g1.dnafrag_start, gene_dnafrag_end: g1.dnafrag_end, gene_dnafrag_strand: g1.dnafrag_strand,
      other_id: g2.stable_id, other_gm_id: g2.gm_id, other_genome_db_id: g2.genome_db_id,
      other_dnafrag_id: g2.dnafrag_id, other_dnafrag_start: g2.dnafrag_start, other_dnafrag_end: g2.dnafrag_end, other_dnafrag_strand: g2.dnafrag_strand,
      kind, gene_ppos: ppos1, other_ppos: ppos2
    };
    // (a) gene_split skip heuristic
    let skip = false;
    if (row.kind === 'gene_split') {
      skip = true;
      if (row.gene_ppos < small_overlap_percentage && row.other_ppos < small_overlap_percentage) {
        const nb = count_genes_between(row);
        if (row.gene_ppos === 0 && row.other_ppos === 0) {
          if (nb <= max_nb_genes_no_overlap + 2 && Math.abs(row.gene_dnafrag_start - row.other_dnafrag_start) <= max_dist_no_overlap) skip = false;
        } else {
          if (nb <= max_nb_genes_small_overlap + 2
              && Math.abs(row.gene_dnafrag_start - row.other_dnafrag_start) <= max_dist_small_overlap
              && Math.abs(row.gene_dnafrag_end - row.other_dnafrag_end) <= max_dist_small_overlap) skip = false;
        }
      }
    }
    // (b) syntenic-block overlap -> prepend 'syntenic_'
    if (row.gene_genome_db_id < row.other_genome_db_id) {
      const iv = synteny[row.gene_genome_db_id] && synteny[row.gene_genome_db_id][row.other_genome_db_id]
              && synteny[row.gene_genome_db_id][row.other_genome_db_id][row.gene_dnafrag_id]
              && synteny[row.gene_genome_db_id][row.other_genome_db_id][row.gene_dnafrag_id][row.other_dnafrag_id];
      if (iv) {
        const interval = iv[bounds.le(iv, { start: row.gene_dnafrag_start }, compareIntervals)];
        if (interval && interval.end >= row.gene_dnafrag_end
            && interval.start2 <= row.other_dnafrag_start && interval.end2 >= row.other_dnafrag_end) row.kind = 'syntenic_' + row.kind;
      }
    } else if (row.gene_genome_db_id > row.other_genome_db_id) {
      const iv = synteny[row.other_genome_db_id] && synteny[row.other_genome_db_id][row.gene_genome_db_id]
              && synteny[row.other_genome_db_id][row.gene_genome_db_id][row.other_dnafrag_id]
              && synteny[row.other_genome_db_id][row.gene_genome_db_id][row.other_dnafrag_id][row.gene_dnafrag_id];
      if (iv) {
        const interval = iv[bounds.le(iv, { start: row.other_dnafrag_start }, compareIntervals)];
        if (interval && interval.end >= row.other_dnafrag_end
            && interval.start2 <= row.gene_dnafrag_start && interval.end2 >= row.gene_dnafrag_end) row.kind = 'syntenic_' + row.kind;
      }
    }
    if (!skip) emitPair(row.gene_id, row.other_id, row.kind);
  }

  // 7) streaming merge-join: homology (1 row / homology_id) drives; homology_member (>=1 rows / id) follows.
  //    Both are in homology_id (PRIMARY) order. Build the g1>g2 pairs like `hm.gene_member_id > hm2.gene_member_id`.
  log('merge-join homology x homology_member ...');
  const hmIter = linesOf(gz('homology_member.tsv.gz'))[Symbol.asyncIterator]();
  let hmN = await hmIter.next();
  const parseHm = l => { const c = l.split('\t'); return { hid: +c[0], gmid: +c[1], ppos: numOrNull(c[2]) }; };
  let hmCur = hmN.done ? null : parseHm(hmN.value);

  let homs = 0, kept = 0;
  for await (const hline of linesOf(gz('homology.tsv.gz'))) {
    const c = hline.split('\t');
    const H = +c[0], kind = c[1];   // c[2] = gene_tree_root_id (all clustersets included; not filtered)
    homs++;
    if (homs % 50000000 === 0) log(`  ${homs} homologies scanned, ${kept} kept, ${pairsOut} pairs`);
    // collect this homology's members (both files sorted ascending by homology_id -> streaming merge)
    while (hmCur && hmCur.hid < H) { hmN = await hmIter.next(); hmCur = hmN.done ? null : parseHm(hmN.value); }
    const members = [];
    while (hmCur && hmCur.hid === H) { members.push(hmCur); hmN = await hmIter.next(); hmCur = hmN.done ? null : parseHm(hmN.value); }
    // resolve to built gene_members
    const res = [];
    for (const m of members) {
      const info = gm.get(m.gmid);
      if (info && builtGdb.has(info.genome_db_id)) res.push({ gm_id: m.gmid, ppos: m.ppos, ...info });
    }
    if (res.length < 2) continue;
    kept++;
    // all ordered pairs with gm_id(i) > gm_id(j)  (g1 = higher gene_member_id, matches hm > hm2)
    for (let i = 0; i < res.length; i++) for (let j = 0; j < res.length; j++) {
      if (res[i].gm_id > res[j].gm_id) processPair(res[i], res[j], kind, res[i].ppos, res[j].ppos);
    }
    if (outBuf.length > OUT_THRESHOLD) await flushOut();
  }
  await flushOut();
  await new Promise(r => process.stdout.end(r));   // ensure the pipe (gzip) gets EOF + drains
  log(`DONE: ${homs} homologies scanned, ${kept} kept (>=2 built members, all clustersets)`);
  log(`      ${pairsOut} pairs emitted (${pairsOut * 2} flatfile lines)`);
  collections.closeMongoDatabase();
  setTimeout(() => process.exit(pairsOut > 0 ? 0 : 1), 200);
})().catch(e => { console.error('build_homologs FAILED:', e && e.stack || e); process.exit(1); });

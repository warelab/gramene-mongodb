#!/usr/bin/env node
'use strict';
// load_homolog_lmdb.js — bulk-load the homolog LMDB from a gene_id-SORTED pairs flatfile on stdin.
// Input lines: "<gene_id>\t<other_id>\t<kind>". Because the input is sorted (LC_ALL=C, whole line),
// keys arrive in ascending byte order and dupSort inserts append to the right of the B-tree
// (sequential, cache-friendly) — fast even for ~1B values on a memory-tight box, unlike the
// random-order LIVE inserts that collapsed to ~2.5K/s. Stores key=gene_id, value="<other_id>\t<kind>"
// (exactly what homolog_adder.js getValues() expects).
//
//   pigz -dc homolog_pairs.sorted.tsv.gz | node --max-old-space-size=8192 load_homolog_lmdb.js <lmdb_path>
const { open } = require('lmdb');

const LMDB_PATH = process.argv[2] || './homologs.lmdb';
const db = open({ path: LMDB_PATH, dupSort: true, encoding: 'string', compression: false,
                  mapSize: 160 * 1024 * 1024 * 1024 });

(async () => {
  const t0 = Date.now();
  await db.clearAsync();                        // idempotent rebuild
  let n = 0;
  const BATCH = 1000000;                        // values per sync transaction
  let batch = [];
  function flush() {
    if (!batch.length) return;
    const b = batch; batch = [];
    db.transactionSync(() => { for (let i = 0; i < b.length; i += 2) db.put(b[i], b[i + 1]); });
  }
  let buf = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    buf += chunk;
    let s = 0, idx;
    while ((idx = buf.indexOf('\n', s)) >= 0) {
      const line = buf.slice(s, idx); s = idx + 1;
      const t = line.indexOf('\t');
      if (t < 0) continue;
      batch.push(line.slice(0, t), line.slice(t + 1));   // key=gene_id, value="other\tkind"
      if (++n % BATCH === 0) {
        flush();
        if (n % 50000000 === 0) console.error(`  loaded ${n} values  ${((Date.now() - t0) / 1000).toFixed(0)}s  ${Math.round(n / ((Date.now() - t0) / 1000))}/s`);
      }
    }
    buf = s ? buf.slice(s) : buf;
  }
  if (buf.length) { const t = buf.indexOf('\t'); if (t >= 0) { batch.push(buf.slice(0, t), buf.slice(t + 1)); n++; } }
  flush();
  await db.flushed;
  const ec = db.getStats().entryCount;
  console.error(`DONE: loaded ${n} values -> entryCount=${ec}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  await db.close();
  console.log(ec);                              // stdout = entry count for the stage to assert on
  setTimeout(() => process.exit(ec > 0 ? 0 : 1), 200);
})().catch(e => { console.error('load_homolog_lmdb FAILED:', e && e.stack || e); process.exit(1); });

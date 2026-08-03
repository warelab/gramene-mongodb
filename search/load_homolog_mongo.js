#!/usr/bin/env node
'use strict';
// load_homolog_mongo.js — load the per-gene homolog store into mongo from a gene_id-SORTED
// pairs flatfile on stdin. Replaces load_homolog_lmdb.js.
//
// Input lines: "<gene_id>\t<other_id>\t<kind>" (both directions, sorted by gene_id).
// Output docs:  {_id: "<gene_id>", homologous_genes: {"<kind>": ["<other_id>", ...]}}
//               i.e. exactly the shape homolog_adder attaches to gene.homology, so the
//               reader is a plain findOne with no per-gene reshaping.
//
// Why mongo instead of LMDB: decorate reads this store once per gene while streaming ~5.4M
// genes. LMDB is a memory-mapped file, so every read faults more of the 18GB map into the
// process RSS — it grew ~1GB per 175k genes and reached ~9-10GB, on top of decorate's own
// ~7-12GB of lookup tables, on a box already 38GB into swap. Mongo keeps its cache in the
// mongod process (bounded by WiredTiger) instead of in decorate's address space, so
// decorate's footprint stays flat.
//
// Because stdin is sorted by gene_id, all rows for a gene are contiguous: we accumulate one
// gene at a time and emit when the key changes, so memory here is O(one gene's homologs).
//
//   pigz -dc homolog_pairs.sorted.tsv.gz | node load_homolog_mongo.js
const collections = require('gramene-mongodb-config');

const BATCH_DOCS = 2000;          // docs per insertMany
const WARN_VALUES = 200000;       // flag implausibly large genes rather than silently shipping them

collections.homologs.mongoCollection().then(async (coll) => {
  const t0 = Date.now();
  await coll.deleteMany({});      // idempotent rebuild

  let nValues = 0, nDocs = 0, maxValues = 0, maxGene = null;
  let curId = null, curKinds = null, curCount = 0;
  let batch = [];

  async function flushBatch() {
    if (!batch.length) return;
    const b = batch; batch = [];
    await coll.insertMany(b, { ordered: false });
  }

  // Sync: pushes the finished gene onto the batch. Returns true when the batch is full and the
  // caller should await flushBatch(). Kept synchronous so the hot path doesn't allocate a promise
  // per input line (190M of them) -- we only await once per BATCH_DOCS genes.
  function emitCurrent() {
    if (curId === null) return false;
    if (curCount > maxValues) { maxValues = curCount; maxGene = curId; }
    if (curCount >= WARN_VALUES) {
      console.error(`  WARNING: ${curId} has ${curCount} homologs`);
    }
    batch.push({ _id: curId, homologous_genes: curKinds });
    nDocs++;
    return batch.length >= BATCH_DOCS;
  }

  function startGene(geneId) {
    curId = geneId; curKinds = Object.create(null); curCount = 0;
  }

  function addPair(otherId, kind) {
    if (curKinds[kind] === undefined) curKinds[kind] = [];
    curKinds[kind].push(otherId);
    curCount++; nValues++;
  }

  function progress() {
    if (nDocs % 500000 !== 0) return;
    const s = (Date.now() - t0) / 1000;
    console.error(`  loaded ${nDocs} genes / ${nValues} values  ${s.toFixed(0)}s  ${Math.round(nValues / s)} values/s`);
  }

  let buf = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    buf += chunk;
    let s = 0, idx;
    while ((idx = buf.indexOf('\n', s)) >= 0) {
      const line = buf.slice(s, idx); s = idx + 1;
      const t1 = line.indexOf('\t');           if (t1 < 0) continue;
      const t2 = line.indexOf('\t', t1 + 1);   if (t2 < 0) continue;
      const geneId = line.slice(0, t1);
      if (geneId !== curId) {                  // key changed -> previous gene is complete
        if (emitCurrent()) { await flushBatch(); progress(); }
        startGene(geneId);
      }
      addPair(line.slice(t1 + 1, t2), line.slice(t2 + 1));
    }
    buf = s ? buf.slice(s) : buf;
  }
  if (buf.length) {
    const t1 = buf.indexOf('\t'), t2 = t1 < 0 ? -1 : buf.indexOf('\t', t1 + 1);
    if (t2 >= 0) {
      const geneId = buf.slice(0, t1);
      if (geneId !== curId) { if (emitCurrent()) await flushBatch(); startGene(geneId); }
      addPair(buf.slice(t1 + 1, t2), buf.slice(t2 + 1));
    }
  }
  emitCurrent();
  await flushBatch();

  const count = await coll.count({});
  const s = (Date.now() - t0) / 1000;
  console.error(`DONE: ${nDocs} gene docs / ${nValues} values in ${s.toFixed(0)}s ` +
                `(collection count=${count}; max ${maxValues} homologs on ${maxGene})`);
  collections.closeMongoDatabase();
  console.log(count);             // stdout = doc count for the stage to assert on
  setTimeout(() => process.exit(count > 0 ? 0 : 1), 200);
}).catch(e => {
  console.error('load_homolog_mongo FAILED:', e && e.stack || e);
  process.exit(1);
});

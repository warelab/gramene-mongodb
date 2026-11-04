#!/usr/bin/env node
'use strict';
// duplicate_vv.js — grapevine replacement for update_vv.pl.
//
// WHY THIS EXISTS. update_vv.pl REPLACES each Vitvi pathway key with its VIT_ equivalent. On the
// Gramene main release that is right: grape genes there are keyed `Vitis##g#####`, so the Vitvi
// keys match nothing and the rewrite is effectively a no-op on a single grape genome.
//
// On this subsite it is actively harmful. There are TWO annotated vinifera assemblies in DIFFERENT
// namespaces -- vitis_vinifera (taxon 29760019, VIT_-keyed, 29,971 genes) and
// vitis_viniferapn40024 (taxon 29760020, Vitvi-keyed, 35,197 genes) -- and measured coverage in the
// live grapevine4 was pn40024 1,113 genes with pathways and vitis_vinifera ZERO. A rewrite MOVES
// the annotations off pn40024 and onto VIT_, so the site nets roughly nothing: one genome gains
// what the other loses.
//
// So: emit BOTH keys. Pathway association is a claim about an ortholog pair, and both members are
// real genes in this build, so annotating both is the correct outcome and the only one that makes
// the site strictly better than v4.
//
// AMBIGUITY. vv_orthologs.v3.v4.txt here is the union of the original 1,033 curated pairs and the
// 22,048 Vitvi/VIT_ pairs in atlas/new_old.lut.txt (all 44,096 ids verified to be real genes in
// grapevine4), giving 22,078 pairs. 11 ids in that union are 1:many -- 4 VIT_ ids with two Vitvi
// partners and 7 Vitvi ids with two VIT_ partners. For a REWRITE that would force an arbitrary
// choice; for duplication it is harmless and conservative: every candidate partner receives the
// annotation. That is why the crosswalk could be unioned rather than having to be reconciled.
//
// Usage, a drop-in for update_vv.pl: reads the raw json on stdin, writes the expanded json on
// stdout. Run from the directory holding vv_orthologs.v3.v4.txt, as the stage does.

const fs = require('fs');
const path = require('path');

const LUT = process.env.VV_ORTHOLOGS || 'vv_orthologs.v3.v4.txt';

// VIT_ -> [Vitvi...] and Vitvi -> [VIT_...]; 1:many is expected, see above.
const fwd = new Map();   // vit   -> Set(vitvi)
const rev = new Map();   // vitvi -> Set(vit)
let pairs = 0;
for (const line of fs.readFileSync(LUT, 'utf8').split('\n')) {
  if (!line) continue;
  const f = line.split('\t');
  const vit = (f[0] || '').trim(), vitvi = (f[1] || '').trim();
  if (!vit || !vitvi) continue;
  if (!fwd.has(vit)) fwd.set(vit, new Set());
  if (!rev.has(vitvi)) rev.set(vitvi, new Set());
  fwd.get(vit).add(vitvi);
  rev.get(vitvi).add(vit);
  pairs++;
}
process.stderr.write('duplicate_vv: ' + pairs + ' ortholog pairs from ' + path.basename(LUT) + '\n');

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => raw += d);
process.stdin.on('end', () => {
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch (e) {
    // Match update_vv.pl's contract: on any trouble, leave the input alone. 25_reactome validates
    // our stdout and falls back to the raw associations, so failing loudly here is safe.
    process.stderr.write('duplicate_vv: input is not valid json (' + e.message + ')\n');
    process.exit(1);
  }

  // Only entries that actually carry something are worth copying. An empty value is exactly the
  // "well-formed but unfilled" state the stage's per-species fill gate exists to catch, and
  // propagating it would launder that failure into a second genome.
  const filled = k => {
    const v = obj[k];
    if (!v || typeof v !== 'object') return false;
    return Object.keys(v).length > 0;
  };
  const clone = k => JSON.parse(JSON.stringify(obj[k]));

  // Snapshot the input keys. Both directions are walked below, so without this a key created by
  // the first pass would be counted as "already present" by the second and the log would overstate
  // how much the two namespaces really shared on input.
  const wasPresent = new Set(Object.keys(obj));
  const created = new Set();

  let added = 0, skippedEmpty = 0;
  const bothPairs = new Set();   // unordered pair keys, so a pair is counted once not once per direction
  const addFrom = (src, targets) => {
    // Only ever copy FROM an input key. A key this run created is already a copy, so using it as a
    // source would both re-copy it and make the pair look like an input overlap.
    if (!wasPresent.has(src)) return;
    if (!filled(src)) { skippedEmpty++; return; }
    for (const t of targets) {
      if (created.has(t)) continue;
      if (wasPresent.has(t)) {
        bothPairs.add([src, t].sort().join('\u0000'));   // genuinely annotated on both sides
        continue;
      }
      obj[t] = clone(src);
      created.add(t);
      added++;
    }
  };
  // Both directions: a pathway set may arrive on either namespace depending on the supplement.
  for (const [vitvi, vits] of rev) addFrom(vitvi, vits);
  for (const [vit, vitvis] of fwd) addFrom(vit, vitvis);

  process.stderr.write("duplicate_vv: added " + added + " keys, " + bothPairs.size +
                       ' already present on both sides, ' + skippedEmpty + ' sources empty (skipped)\n');
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
});

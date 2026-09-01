#!/usr/bin/env node
/**
 * check_new_atlas_experiments.js
 *
 * Lists EBI Expression Atlas experiments that are relevant to the genomes this release hosts but
 * are NOT yet in the local `experiments` collection. Read-only: fetches one JSON index from GXA and
 * queries mongo. Nothing is loaded or modified.
 *
 *   MONGO_URI="mongodb://localhost:27017" MONGO_DB="sorghum11" node check_new_atlas_experiments.js
 *
 * Options (env):
 *   ALL=1        also list species GXA has that this release does not host (see "coming soon")
 *   SINCE=2026   only report experiments loaded/updated in or after this year
 *   TECH=all     include microarray too (default: RNA-Seq only — see below)
 *   JSON=1       emit machine-readable JSON instead of a report
 *
 * Technology. This pipeline loads RNA-Seq only: of the 363 experiments in sorghum11, all 336 that
 * still appear in the GXA index are "RNA-Seq mRNA" and none are microarray. GXA plants are roughly
 * half microarray (557 of 1026), so without this filter the report is swamped by ~500 old
 * microarray studies that were never wanted. TECH=all lifts the filter.
 *
 * Species matching. The loader (getAtlasData.js) keys off NCBI taxon ids carried in the Atlas TSV
 * dumps; this index only carries species NAMES, and our taxonomy stores munged display names for
 * genome taxa ("Zea maysB73" for what GXA calls "Zea mays"). So we match on the exact name first,
 * then fall back to the genus. A genus hit is reported as NEAR so it gets eyeballed rather than
 * silently dropped — under-reporting is the failure mode that matters here.
 */
"use strict";
const { MongoClient } = require("mongodb");
const https = require("https");

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017";
const MONGO_DB  = process.env.MONGO_DB;
const GXA_URL   = process.env.GXA_URL || "https://www.ebi.ac.uk/gxa/json/experiments";
const SINCE     = process.env.SINCE ? parseInt(process.env.SINCE, 10) : null;
const SHOW_ALL  = process.env.ALL === "1";
const TECH_ALL  = String(process.env.TECH || "").toLowerCase() === "all";
const AS_JSON   = process.env.JSON === "1";

if (!MONGO_DB) { console.error("MONGO_DB is required (e.g. MONGO_DB=sorghum11)"); process.exit(2); }

const get = url => new Promise((resolve, reject) => {
  https.get(url, { headers: { accept: "application/json" } }, res => {
    if (res.statusCode >= 300) { res.resume(); return reject(new Error(url + " -> HTTP " + res.statusCode)); }
    let b = ""; res.setEncoding("utf8");
    res.on("data", d => b += d);
    res.on("end", () => { try { resolve(JSON.parse(b)); } catch (e) { reject(new Error("bad JSON from " + url)); } });
  }).on("error", reject);
});

// "13-04-2026" (GXA) or an ISO-ish date -> year
const yearOf = s => {
  if (!s) return null;
  let m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s);        // dd-mm-yyyy
  if (m) return +m[3];
  m = /(\d{4})/.exec(s);
  return m ? +m[1] : null;
};
const norm  = s => String(s || "").trim().toLowerCase();
const genus = s => norm(s).split(/\s+/)[0];

(async () => {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(MONGO_DB);

  const taxa  = await db.collection("taxonomy").find({}, { projection: { _id: 1, name: 1 } }).toArray();
  const mine  = await db.collection("experiments").find({}, { projection: { _id: 1 } }).toArray();
  const have  = new Set(mine.map(d => String(d._id)));
  await client.close();

  const byName  = new Map();   // exact lowercase name -> taxon id
  const byGenus = new Map();   // genus -> [{id,name}]
  for (const t of taxa) {
    if (!t.name) continue;
    byName.set(norm(t.name), t._id);
    const g = genus(t.name);
    if (!byGenus.has(g)) byGenus.set(g, []);
    byGenus.get(g).push({ id: t._id, name: t.name });
  }

  const all = (await get(GXA_URL)).experiments || [];
  // Deliberately NOT filtered to kingdom=plants: this release hosts Drosophila melanogaster as an
  // outgroup and holds 27 experiments for it, which a plants-only filter would never report as new.
  // Membership of the local taxonomy is the real criterion, so let the species match decide.
  const isRnaSeq = e => (e.technologyType || []).some(t => /rna-?seq/i.test(t));
  const candidates = TECH_ALL ? all : all.filter(isRnaSeq);
  const skippedTech = all.length - candidates.length;
  const plants = candidates;

  // Accessions we hold that the current GXA index no longer lists — withdrawn or re-accessioned
  // upstream. Not actionable automatically, but worth seeing.
  const gxaIds = new Set(all.map(e => e.experimentAccession));
  const retired = [...have].filter(a => !gxaIds.has(a)).sort();

  const hosted = [], near = [], notHosted = new Map();
  for (const e of plants) {
    const sp = e.species;
    const rec = {
      accession: e.experimentAccession, species: sp, type: e.experimentType,
      assays: e.numberOfAssays, lastUpdate: e.lastUpdate, loadDate: e.loadDate,
      description: e.experimentDescription,
      year: yearOf(e.loadDate) || yearOf(e.lastUpdate)
    };
    if (byName.has(norm(sp)))      { rec.taxon = byName.get(norm(sp)); hosted.push(rec); }
    else if (byGenus.has(genus(sp))) { rec.match = byGenus.get(genus(sp)).map(x => x.name + "(" + x.id + ")").join(", "); near.push(rec); }
    else if (norm(e.kingdom) === "plants") { notHosted.set(sp, (notHosted.get(sp) || 0) + 1); }  // "coming soon" list stays plants-only
  }

  const isNew = r => !have.has(r.accession) && (!SINCE || (r.year && r.year >= SINCE));
  const newHosted = hosted.filter(isNew);
  const newNear   = near.filter(isNew);

  if (AS_JSON) {
    console.log(JSON.stringify({ db: MONGO_DB, haveCount: have.size, plants: plants.length, retired,
      newHosted, newNear, notHosted: [...notHosted].map(([s, n]) => ({ species: s, experiments: n })) }, null, 2));
    return;
  }

  const line = r => "    " + r.accession.padEnd(16) + (r.type || "?").padEnd(10) +
    String(r.assays || "?").padStart(5) + " assays  " + String(r.loadDate || r.lastUpdate || "?").padEnd(12) +
    (r.description || "").slice(0, 60);
  const group = rows => {
    const by = new Map();
    for (const r of rows) { if (!by.has(r.species)) by.set(r.species, []); by.get(r.species).push(r); }
    for (const [sp, rs] of [...by].sort((a, b) => b[1].length - a[1].length)) {
      console.log("  " + sp + "  (" + rs.length + ")" + (rs[0].match ? "   ~ our taxonomy has: " + rs[0].match : ""));
      rs.sort((a, b) => (b.year || 0) - (a.year || 0)).forEach(r => console.log(line(r)));
    }
  };

  console.log("EBI Expression Atlas vs " + MONGO_DB + (SINCE ? "   (loaded/updated since " + SINCE + ")" : ""));
  console.log("  GXA experiments considered: " + plants.length +
    (TECH_ALL ? " (all technologies)" : " RNA-Seq (" + skippedTech + " microarray/other skipped; TECH=all to include)") +
    "    already loaded here: " + have.size);
  console.log("");
  console.log("NEW for genomes we host: " + newHosted.length);
  if (newHosted.length) group(newHosted); else console.log("  none");
  console.log("");
  console.log("NEW, species name is a near match (genus only) — check these by hand: " + newNear.length);
  if (newNear.length) group(newNear); else console.log("  none");

  if (retired.length) {
    console.log("");
    console.log("Loaded here but no longer in the GXA index (" + retired.length + ") — withdrawn or re-accessioned upstream:");
    console.log("  " + retired.join(" "));
  }

  if (SHOW_ALL) {
    console.log("");
    console.log("GXA plant species this release does NOT host (" + notHosted.size + ") — relevant when new genomes land:");
    [...notHosted].sort((a, b) => b[1] - a[1]).forEach(([s, n]) => console.log("  " + String(n).padStart(4) + "  " + s));
  }
})().catch(e => { console.error("FAILED: " + (e && e.message || e)); process.exit(1); });

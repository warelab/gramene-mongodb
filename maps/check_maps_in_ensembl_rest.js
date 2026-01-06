#!/usr/bin/env node
/**
 * check_maps_sequence_availability.js
 *
 * Iterates over documents in MongoDB collection `maps` and checks whether each
 * map's `system_name` resolves in the REST API sequence/region endpoint.
 *
 * Prints reg.pm entry per missing/unavailable map:
 *   <system_name>\t<db>
Bio::EnsEMBL::DBSQL::DBAdaptor->new
  ( '-species' => 'arabidopsis_thaliana',
    '-group'   => 'core',
    '-port'    => $def_port,
    '-host'    => $def_host,
    '-user'    => $def_user,
    '-pass'    => $def_pass,
    '-dbname'  => "arabidopsis_thaliana_core_7_108_11", );
 *
 * Usage:
 *   MONGO_URI="mongodb://localhost:27017" \
 *   MONGO_DB="your_db_name" \
 *   BASE_URL="https://data.gramene.org/pansite-ensembl-108" \
 *   node check_maps_sequence_availability.js
 *
 * Optional:
 *   CONCURRENCY=10
 *   LIMIT=0            # 0 means no limit
 *   QUERY='{"db":"pansite-ensembl-108"}'   # optional JSON filter for maps docs
 */

"use strict";

const { MongoClient } = require("mongodb");

const MONGO_URI = process.env.MONGO_URI;
const MONGO_DB = process.env.MONGO_DB;
const BASE_URL = process.env.BASE_URL || "https://data.gramene.org/pansite-ensembl-108";
const CONCURRENCY = Number.parseInt(process.env.CONCURRENCY || "8", 10);
const LIMIT = Number.parseInt(process.env.LIMIT || "0", 10);

if (!MONGO_URI || !MONGO_DB) {
  console.error("Missing required env vars: MONGO_URI and/or MONGO_DB");
  process.exit(1);
}

function parseOptionalJsonEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`Env var ${name} is not valid JSON: ${raw}`);
  }
}

const MAPS_QUERY = parseOptionalJsonEnv("QUERY", {});

// Small promise pool for concurrency-limited async work
async function asyncPool(limit, items, worker) {
  const ret = [];
  const executing = new Set();

  for (const item of items) {
    const p = Promise.resolve().then(() => worker(item));
    ret.push(p);
    executing.add(p);

    const clean = () => executing.delete(p);
    p.then(clean).catch(clean);

    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }
  return Promise.allSettled(ret);
}

function buildEndpoint(baseUrl, systemName) {
  // Example:
  // https://data.gramene.org/pansite-ensembl-108/info/assembly/sorghum_tx430nano?content-type=application/json
  const base = baseUrl.replace(/\/+$/, "");
  const encSystem = encodeURIComponent(systemName);
  return `${base}/info/assembly/${encSystem}?content-type=application/json`;
}

async function checkOne({ system_name, db }) {
  if (!system_name) {
    return { ok: false, reason: "missing_system_name", system_name, db };
  }

  const url = buildEndpoint(BASE_URL, system_name);

  let res;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  } catch (e) {
    return { ok: false, reason: "fetch_failed", system_name, db, detail: String(e) };
  }

  // If the API returns non-2xx, treat as unavailable; still try to parse body if possible.
  let bodyText = "";
  try {
    bodyText = await res.text();
  } catch (_) {
    // ignore
  }

  let json = null;
  if (bodyText) {
    try {
      json = JSON.parse(bodyText);
    } catch (_) {
      // ignore parse errors
    }
  }

  // Your specific "not found" signature:
  // { "error": "Can not find internal name for species 'sordghum_bicolor'" }
  const errMsg =
    (json && typeof json.error === "string" && json.error) ||
    (json && typeof json.message === "string" && json.message) ||
    "";

  const looksLikeMissingSpecies =
    errMsg.includes("Can not find internal name for species") ||
    errMsg.includes("Cannot find internal name for species") ||
    errMsg.includes("Can not find internal name");

  if (!res.ok || looksLikeMissingSpecies) {
    return {
      ok: false,
      reason: looksLikeMissingSpecies ? "missing_species" : `http_${res.status}`,
      system_name,
      db,
      detail: errMsg || (bodyText ? bodyText.slice(0, 200) : ""),
      url,
    };
  }

  // If it returns *something*, we consider it available.
  return { ok: true, system_name, db };
}

async function main() {
  const client = new MongoClient(MONGO_URI, {
    // keeps things resilient on flaky networks
    maxPoolSize: 10,
  });

  await client.connect();
  const dbo = client.db(MONGO_DB);
  const maps = dbo.collection("maps");

  const projection = { system_name: 1, db: 1 };
  const cursor = maps.find(MAPS_QUERY, { projection });

  const docs = [];
  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    docs.push(doc);
    if (LIMIT > 0 && docs.length >= LIMIT) break;
  }

  // Check in parallel (concurrency-limited)
  const results = await asyncPool(CONCURRENCY, docs, checkOne);

  // Output unavailable maps as: system_name \t db
  // (one per line, easy to redirect to a file)
  for (const r of results) {
    if (r.status !== "fulfilled") {
      // Worker threw unexpectedly; no doc context available here
      console.error(`# worker_error\t${String(r.reason)}`);
      continue;
    }
    const out = r.value;
    if (!out.ok) {
      // required output: system_name and db attributes
      process.stdout.write(`
    Bio::EnsEMBL::DBSQL::DBAdaptor->new
      ( '-species' => '${out.system_name}',
        '-group'   => 'core',
        '-port'    => $def_port,
        '-host'    => $def_host,
        '-user'    => $def_user,
        '-pass'    => $def_pass,
        '-dbname'  => "${out.db}", );
        `);
    }
  }

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { MongoClient } = require('mongodb');

/**
 * Count newline-delimited lines in a gzipped text file (streaming).
 * Counts the last line even if it doesn't end with '\n' (if it has content).
 */
function countLinesInGzip(filePath) {
  return new Promise((resolve, reject) => {
    let lines = 0;
    let hadAnyData = false;
    let lastByteWasNewline = false;

    const rs = fs.createReadStream(filePath);
    rs.on('error', reject);

    const gunzip = zlib.createGunzip();
    gunzip.on('error', reject);

    gunzip.on('data', (chunk) => {
      if (!chunk || chunk.length === 0) return;
      hadAnyData = true;

      // Count '\n' bytes
      for (let i = 0; i < chunk.length; i++) {
        if (chunk[i] === 10) lines++; // '\n'
      }
      lastByteWasNewline = chunk[chunk.length - 1] === 10;
    });

    gunzip.on('end', () => {
      // If file had data and didn't end with newline, there's one last line
      if (hadAnyData && !lastByteWasNewline) lines += 1;
      resolve(lines);
    });

    rs.pipe(gunzip);
  });
}

/**
 * Get system_name from filename like "vitis_vinifera.json.gz"
 */
function systemNameFromFilename(filename) {
  if (!filename.endsWith('.json.gz')) return null;
  return filename.slice(0, -'.json.gz'.length);
}

async function main() {
  // ---- Config via env vars ----
  const DIR = process.env.GENOME_DIR || process.argv[2];
  const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017';
  const DB_NAME = process.env.DB_NAME || 'sorghum10';
  const COLLECTION = process.env.COLLECTION || 'maps';

  if (!DIR) {
    console.error('Usage: GENOME_DIR=/path/to/dir node compare_gz_lines_vs_num_genes.js');
    console.error('   or: node compare_gz_lines_vs_num_genes.js /path/to/dir');
    console.error('Env: MONGO_URI, DB_NAME, COLLECTION');
    process.exit(2);
  }

  const dirPath = path.resolve(DIR);
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    console.error(`Not a directory: ${dirPath}`);
    process.exit(2);
  }

  // List gz files
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const gzFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith('.json.gz'))
    .map((e) => e.name)
    .sort();

  if (gzFiles.length === 0) {
    console.error(`No .json.gz files found in ${dirPath}`);
    process.exit(2);
  }

  const client = new MongoClient(MONGO_URI, { ignoreUndefined: true });

  let mismatches = 0;
  let missingInMongo = 0;
  let missingFiles = 0;

  try {
    await client.connect();
    const coll = client.db(DB_NAME).collection(COLLECTION);

    // Optional: fetch all genomes once to also detect genomes in Mongo missing files
    // If you have a LOT, you may want to skip this or project only needed fields.
    const mongoGenomes = await coll
      .find({}, { projection: { _id: 0, system_name: 1, num_genes: 1 } })
      .toArray();

    const mongoBySystem = new Map(
      mongoGenomes
        .filter((d) => d && d.system_name)
        .map((d) => [d.system_name, d])
    );

    // Compare each file to Mongo
    console.log(
      ['system_name', 'file_lines', 'mongo_num_genes', 'status', 'file'].join('\t')
    );

    for (const filename of gzFiles) {
      const system_name = systemNameFromFilename(filename);
      if (!system_name) continue;

      const fullPath = path.join(dirPath, filename);
      const lineCount = await countLinesInGzip(fullPath);

      const doc = mongoBySystem.get(system_name);
      if (!doc) {
        missingInMongo += 1;
        console.log(
          [system_name, lineCount, '', 'NO_MONGO_DOC', filename].join('\t')
        );
        continue;
      }

      const numGenes = doc.num_genes;
      const ok = Number.isFinite(numGenes) ? lineCount === numGenes : false;

      if (!ok) mismatches += 1;

      console.log(
        [
          system_name,
          lineCount,
          numGenes ?? '',
          ok ? 'OK' : 'MISMATCH',
          filename,
        ].join('\t')
      );
    }

    // Also detect Mongo genomes that have no corresponding file
    const fileSystemNames = new Set(gzFiles.map(systemNameFromFilename).filter(Boolean));
    for (const sys of mongoBySystem.keys()) {
      if (!fileSystemNames.has(sys)) missingFiles += 1;
    }

    console.error('\nSummary');
    console.error(`  Files checked:          ${gzFiles.length}`);
    console.error(`  Missing Mongo docs:     ${missingInMongo}`);
    console.error(`  Mismatches:             ${mismatches}`);
    console.error(`  Mongo entries w/o file: ${missingFiles}`);

    // Non-zero exit if anything is off
    if (missingInMongo || mismatches || missingFiles) process.exit(1);
    process.exit(0);
  } finally {
    await client.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});

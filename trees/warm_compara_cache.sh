#!/usr/bin/env bash
# warm_compara_cache.sh — pull compara's tree-dump working set into colden's OS page cache before
# 35_genetrees runs.
#
# WHY THIS EXISTS
# genetree.js dumps trees in batches of 100 root_ids. Each batch's SQL joins gene_tree_node to
# seq_member, sequence, gene_member, gene_tree_node_attr and gene_align_member by primary key, so a
# batch is ~200-270k rows assembled from scattered single-row lookups across ~33 GB of MyISAM.
# key_buffer_size on colden is 32 MB against 11 GB of MyISAM indexes, so essentially all of that
# caching is the OS page cache, not MySQL.
#
# When the page cache holds the working set a batch takes ~9s; when it is cold the SAME batch takes
# ~63s, and the stage as a whole degrades far worse than that ratio because 1,703 consecutive batches
# all miss. Measured on 2026-10-13: the stage ran at 24.7 trees/min, projecting 115 HOURS, against
# 48 minutes for the identical 170,253 trees on 2026-07-08. Running this script against the
# already-executing stage took it to 2,625 trees/min — a 106x recovery, no restart needed.
#
# What empties the cache is any unrelated full scan of a big compara table: the stable-id rename
# UPDATEs, a dump, or an exploratory MD5 query over sequence. So the cache being cold is the NORMAL
# state after maintenance, and this is cheap insurance rather than a fix for a one-off.
#
# COST AND SAFETY
# ~81 seconds for all six tables (colden sustains ~420 MB/s sequential), and it is strictly
# read-only. Measured against the live site between tables: www.gramene.org stayed at 24-72 ms
# throughout. Note the scans are deliberately SUM(...) over a non-indexed column -- on MyISAM a bare
# COUNT(*) is answered from stored metadata and reads nothing at all.
set -euo pipefail

# Source the build config ourselves when the caller has not. Requiring the caller to do it made
# this script a silent no-op in the one place it matters most: a build chain that exports only the
# vars its stages need calls this, it exits 1 on the unset MYSQL_HOST, the chain logs the rc and
# carries on, and 35_genetrees then runs against a cold cache -- 0 trees/min at the start of a
# 386k-tree stage, against 1,000-2,600/min warm. Explicit env still wins; this only fills gaps.
if [ -z "${MYSQL_HOST:-}" ] || [ -z "${MYSQL_USER:-}" ]; then
  _cfg="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../build" 2>/dev/null && pwd)/config.sh"
  if [ -r "${_cfg}" ]; then
    # shellcheck disable=SC1090
    . "${_cfg}" >/dev/null 2>&1 || true
    echo "sourced ${_cfg} for the mysql connection" >&2
  fi
fi

: "${MYSQL_HOST:?set MYSQL_HOST (or run from a tree where ../../build/config.sh is readable)}"
: "${MYSQL_USER:?set MYSQL_USER}"
COMPARA_DB="${COMPARA_DB:-$(node -e "console.log(require('../ensembl_db_info.json').compara.database)" 2>/dev/null || echo ensembl_compara_plants_70_116)}"

MY=(mysql -h "${MYSQL_HOST}" -u "${MYSQL_USER}" ${MYSQL_PASS:+-p"${MYSQL_PASS}"} -N -s -D "${COMPARA_DB}")

echo "warming ${COMPARA_DB} tree-dump working set (~33 GB, read-only)"
# Smallest and most randomly-accessed first, so the stage benefits as early as possible.
for spec in \
  'gene_member|SUM(LENGTH(stable_id))' \
  'seq_member|SUM(LENGTH(stable_id))' \
  'gene_tree_node_attr|SUM(bootstrap)' \
  'gene_tree_node|SUM(distance_to_parent)' \
  'sequence|SUM(LENGTH(sequence))' \
  'gene_align_member|SUM(LENGTH(cigar_line))'
do
  tbl="${spec%%|*}"; expr="${spec##*|}"
  s=$(date +%s)
  "${MY[@]}" -e "SELECT ${expr} FROM ${tbl}" > /dev/null
  printf '  %-20s %3ds\n' "${tbl}" "$(( $(date +%s) - s ))"
done
echo "done"

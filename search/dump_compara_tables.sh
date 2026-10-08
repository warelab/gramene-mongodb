#!/usr/bin/env bash
# dump_compara_tables.sh — dump the minimal compara columns needed to build the cross-species
# homolog store locally (see build_homologs.js), instead of the giant random-access MySQL join in
# dump_homologs.js. Each dump is a single-table SEQUENTIAL scan (fast on colden's 4GB-buffer-pool box)
# streamed straight to gzip. Resumable: a table whose .tsv.gz already exists and passes `gzip -t` is
# skipped, so a re-run only re-dumps what's missing/partial.
#
#   bash dump_compara_tables.sh [OUTDIR]      # default OUTDIR = <this dir>/tmp_homologs
#
# Connection comes from ../ensembl_db_info.json (compara block: host/user/password/database).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:-$here/tmp_homologs}"
mkdir -p "$OUT"

DBINFO="$here/../ensembl_db_info.json"
CNF="$(mktemp)"; trap 'rm -f "$CNF"' EXIT
node -e 'const c=require(process.argv[1]).compara;
process.stdout.write("[client]\nhost="+(c.host||"localhost")+"\nuser="+c.user+"\npassword="+(c.password||"")+"\n");' \
  "$DBINFO" > "$CNF"
chmod 600 "$CNF"
DB="$(node -e 'console.log(require(process.argv[1]).compara.database)' "$DBINFO")"
echo "compara db = $DB"

command -v pigz >/dev/null && Z="pigz -p 32" || Z="gzip"

dump() {  # name  sql
  local name="$1" sql="$2" f="$OUT/$1.tsv.gz"
  if [ -s "$f" ] && gzip -t "$f" 2>/dev/null; then
    echo "  [skip] $name ($(du -h "$f" | cut -f1), already complete)"; return
  fi
  echo "  [dump] $name ..."
  mysql --defaults-extra-file="$CNF" -N -q "$DB" -e "$sql" | $Z > "$f.part"
  mv "$f.part" "$f"
  echo "  [done] $name ($(du -h "$f" | cut -f1))"
}

# The homology / homology_member full-table scans do NOT come back in homology_id (PK) order — MySQL
# returns them grouped by another path (observed: by gene_tree_root_id range). build_homologs.js does a
# streaming merge-join of the two on homology_id, which REQUIRES both ascending, so we sort by column 1
# (homology_id) inline. -S kept modest (box is memory-tight); temp in $OUT/sorttmp.
dump_sorted_by_hid() {  # name  sql
  local name="$1" sql="$2" f="$OUT/$1.tsv.gz"
  if [ -s "$f" ] && gzip -t "$f" 2>/dev/null; then
    echo "  [skip] $name ($(du -h "$f" | cut -f1), already complete)"; return
  fi
  echo "  [dump+sort] $name (sequential scan | sort by homology_id | gz) ..."
  mkdir -p "$OUT/sorttmp"
  mysql --defaults-extra-file="$CNF" -N -q "$DB" -e "$sql" \
    | LC_ALL=C sort -t$'\t' -k1,1n -S 10G --parallel=16 -T "$OUT/sorttmp" \
    | $Z > "$f.part"
  mv "$f.part" "$f"; rmdir "$OUT/sorttmp" 2>/dev/null
  echo "  [done] $name ($(du -h "$f" | cut -f1))"
}

# small/medium first, the two 1B-row tables last
dump gene_member     "SELECT gene_member_id, stable_id, genome_db_id, dnafrag_id, dnafrag_start, dnafrag_end, dnafrag_strand FROM gene_member"
dump genome_db       "SELECT genome_db_id, name FROM genome_db"
dump default_roots   "SELECT root_id FROM gene_tree_root WHERE tree_type='tree' AND clusterset_id='default'"
dump synteny         "SELECT dr.dnafrag_id, dr.dnafrag_start, dr.dnafrag_end, dr.synteny_region_id, d.genome_db_id FROM dnafrag_region dr, dnafrag d WHERE d.dnafrag_id=dr.dnafrag_id AND dr.dnafrag_end-dr.dnafrag_start<10000000 ORDER BY dr.synteny_region_id, d.genome_db_id DESC"
dump_sorted_by_hid homology_member "SELECT homology_id, gene_member_id, perc_pos FROM homology_member"
dump_sorted_by_hid homology        "SELECT homology_id, description, gene_tree_root_id FROM homology"

echo "all compara dumps complete in $OUT"

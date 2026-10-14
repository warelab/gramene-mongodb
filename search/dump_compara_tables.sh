#!/usr/bin/env bash
# dump_compara_tables.sh — dump the minimal compara columns needed to build the cross-species
# homolog store locally (see build_homologs.js), instead of the giant random-access MySQL join in
# dump_homologs.js. Each dump is a single-table SEQUENTIAL scan (fast on colden's 4GB-buffer-pool box)
# streamed straight to gzip.
#
# RESUMABLE, BUT VERIFIED BY ROW COUNT -- NOT BY `gzip -t`.
# The original skip test was `[ -s "$f" ] && gzip -t "$f"`, which proves only that the gzip stream
# is intact. On 2026-10-14 homology_member.tsv.gz was found to hold 965,185,582 of the table's
# 2,114,930,328 rows -- 46%, missing ~1.15 BILLION rows -- while passing `gzip -t`, being correctly
# sorted, and reaching the table's true max homology_id. Three stage-45 runs skipped it as
# "already complete", and the resulting search70.homologs contained essentially only
# within-species paralogs: for Os01g0517500, 42 homologs against release 69's 239, with every
# cross-species ortholog missing. The build verified that 9,083,100 docs were written, never that
# they were the right ones.
#
# So every dump now records its row count in a <name>.rows sidecar, counted inline as it is
# written, and that count is checked against SELECT COUNT(*) both when the dump is created and
# whenever it is skipped. A dump with no sidecar is untrusted and re-dumped. Counting inline costs
# nothing (one awk pass already in the pipeline); counting a finished 2.1B-row gz would cost a
# 10-minute extra read.
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

# rows_in_db <sql-count-expr> -> the authoritative count. MyISAM keeps an exact count, so a bare
# COUNT(*) is instant and costs nothing even on the 2.1B-row tables.
rows_in_db() {
  mysql --defaults-extra-file="$CNF" -N -s "$DB" -e "SELECT COUNT(*) FROM $1"
}

# verify_rows <name> <table> -> 0 if the sidecar matches the live table, else 1 (and says why)
verify_rows() {
  local name="$1" table="$2" f="$OUT/$1.tsv.gz" sc="$OUT/$1.rows"
  if [ ! -s "$sc" ]; then
    echo "  [recheck] $name has no .rows sidecar -> untrusted, re-dumping" >&2
    return 1
  fi
  local have want
  have="$(tr -dc '0-9' < "$sc")"
  want="$(rows_in_db "$table")"
  if [ "$have" != "$want" ]; then
    echo "  [recheck] $name row count $have != table $want -> re-dumping" >&2
    return 1
  fi
  return 0
}

dump() {  # name  sql  [count_table]
  local name="$1" sql="$2" table="${3:-}" f="$OUT/$1.tsv.gz" sc="$OUT/$1.rows"
  if [ -s "$f" ] && gzip -t "$f" 2>/dev/null; then
    if [ -z "$table" ] || verify_rows "$name" "$table"; then
      echo "  [skip] $name ($(du -h "$f" | cut -f1), row count verified)"; return
    fi
  fi
  echo "  [dump] $name ..."
  rm -f "$sc"
  mysql --defaults-extra-file="$CNF" -N -q "$DB" -e "$sql" \
    | awk -v sc="$sc" '{ print; n++ } END { print n+0 > sc }' \
    | $Z > "$f.part"
  mv "$f.part" "$f"
  if [ -n "$table" ]; then
    local have want
    have="$(tr -dc '0-9' < "$sc")"
    want="$(rows_in_db "$table")"
    if [ "$have" != "$want" ]; then
      rm -f "$f" "$sc"
      echo "FATAL: $name dumped $have rows but $table holds $want -- dump removed" >&2
      exit 1
    fi
    echo "  [done] $name ($(du -h "$f" | cut -f1), $have rows == table)"
  else
    echo "  [done] $name ($(du -h "$f" | cut -f1))"
  fi
}

# The homology / homology_member full-table scans do NOT come back in homology_id (PK) order — MySQL
# returns them grouped by another path (observed: by gene_tree_root_id range). build_homologs.js does a
# streaming merge-join of the two on homology_id, which REQUIRES both ascending, so we sort by column 1
# (homology_id) inline. -S kept modest (box is memory-tight); temp in $OUT/sorttmp.
dump_sorted_by_hid() {  # name  sql  table
  local name="$1" sql="$2" table="$3" f="$OUT/$1.tsv.gz" sc="$OUT/$1.rows"
  if [ -s "$f" ] && gzip -t "$f" 2>/dev/null && verify_rows "$name" "$table"; then
    echo "  [skip] $name ($(du -h "$f" | cut -f1), row count verified)"; return
  fi
  echo "  [dump+sort] $name (sequential scan | sort by homology_id | gz) ..."
  mkdir -p "$OUT/sorttmp"
  rm -f "$sc"
  # The awk sits AFTER the sort so it counts what actually lands in the file, and it also asserts
  # the ascending order build_homologs.js's streaming merge-join depends on. A single out-of-order
  # row there makes the join silently skip every homology until the ids re-align, which is how the
  # 2026-10-14 loss first looked before the row count proved it was truncation instead.
  mysql --defaults-extra-file="$CNF" -N -q "$DB" -e "$sql" \
    | LC_ALL=C sort -t$'\t' -k1,1n -S 10G --parallel=16 -T "$OUT/sorttmp" \
    | awk -v sc="$sc" -F'\t' '
        NR > 1 && ($1 + 0) < (p + 0) {
          printf "FATAL: %s not ascending at row %d: %s -> %s\n", "'"$name"'", NR, p, $1 > "/dev/stderr"
          exit 2
        }
        { print; p = $1; n++ }
        END { print n+0 > sc }' \
    | $Z > "$f.part"
  mv "$f.part" "$f"; rmdir "$OUT/sorttmp" 2>/dev/null || true
  local have want
  have="$(tr -dc '0-9' < "$sc")"
  want="$(rows_in_db "$table")"
  if [ "$have" != "$want" ]; then
    rm -f "$f" "$sc"
    echo "FATAL: $name dumped $have rows but $table holds $want -- dump removed" >&2
    exit 1
  fi
  echo "  [done] $name ($(du -h "$f" | cut -f1), $have rows == table)"
}

# small/medium first, the two 1B-row tables last
dump gene_member     "SELECT gene_member_id, stable_id, genome_db_id, dnafrag_id, dnafrag_start, dnafrag_end, dnafrag_strand FROM gene_member" gene_member
dump genome_db       "SELECT genome_db_id, name FROM genome_db" genome_db
# tree_roots replaces the old default_roots dump, which selected only clusterset_id='default' and
# which NOTHING ever read -- grep found the line that created it and no consumer. Now it carries
# clusterset_id and tree_type for EVERY root, so build_homologs.js can attribute each homology to
# the tree set it came from (default -> gene_tree, rice_cultivars -> rice, ...) instead of pooling
# them into one undifferentiated bucket.
dump tree_roots      "SELECT root_id, clusterset_id, tree_type FROM gene_tree_root" gene_tree_root
dump synteny         "SELECT dr.dnafrag_id, dr.dnafrag_start, dr.dnafrag_end, dr.synteny_region_id, d.genome_db_id FROM dnafrag_region dr, dnafrag d WHERE d.dnafrag_id=dr.dnafrag_id AND dr.dnafrag_end-dr.dnafrag_start<10000000 ORDER BY dr.synteny_region_id, d.genome_db_id DESC"
dump_sorted_by_hid homology_member "SELECT homology_id, gene_member_id, perc_pos FROM homology_member" homology_member
dump_sorted_by_hid homology        "SELECT homology_id, description, gene_tree_root_id FROM homology" homology

echo "all compara dumps complete in $OUT"

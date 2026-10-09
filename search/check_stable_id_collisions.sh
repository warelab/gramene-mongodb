#!/usr/bin/env bash
# check_stable_id_collisions.sh — assert that no gene stable id appears in more than one genome.
#
# WHY THIS EXISTS
# Gramene keys gene documents on the gene stable id: it is `_id` in <db>.genes and the Solr
# uniqueKey `id`. Ensembl stable ids are meant to be globally unique, so nothing downstream guards
# against two genomes claiming the same one -- the second write simply replaces the first, and the
# collection's total still looks plausible.
#
# It has happened twice, and shipped once:
#   * triticum_aestivum vs triticum_aestivum_alchemy -- 103,039 shared ids, because the r70 alchemy
#     core labels its genes TraesCS* (the REFERENCE's namespace) where the r69 core for the same
#     assembly correctly used TraesALC*. In search69 the cultivar won, so the live site serves
#     17,705 of reference wheat's 120,744 genes.
#   * lablab_purpureus_gca030347555v1cm vs medicago_truncatula -- 24,925 shared ids, both annotated
#     with placeholder geneNNNN ids because no real stable ids were ever assigned.
#
# The first symptom in the v70 build was not missing genes. It was decorate dying inside
# genetree_adder on a tree holding two leaves with the same gene_stable_id, nine minutes into a
# 16.1M-gene stage. This turns that into a named failure before any of it runs.
#
# WHY SORT RATHER THAN A HASH IN MEMORY
# A Map of 16.1M id strings exhausts a 4 GB V8 heap. An external sort is exact, needs a bounded
# amount of RAM, and uses the same tools 45_homologs already depends on.
#
# USAGE
#   check_stable_id_collisions.sh [dump_dir]
#     dump_dir               default: <this script's dir>/tmp
#     SORT_TMP               scratch for the sort (default $TMPDIR or /tmp) -- needs ~1 GB
#     SORT_MEM               sort buffer (default 2G)
#     STABLE_ID_COLLISION_ALLOW   comma-separated genomeA:genomeB pairs, order-insensitive,
#                                 that have been examined and knowingly accepted
#
# Exits 0 when clean, or when every colliding pair is explicitly allow-listed; 1 otherwise.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIR="${1:-${HERE}/tmp}"
SORT_TMP="${SORT_TMP:-${TMPDIR:-/tmp}}"
SORT_MEM="${SORT_MEM:-2G}"
ALLOW_RAW="${STABLE_ID_COLLISION_ALLOW:-}"

[ -d "${DIR}" ] || { echo "FATAL: dump directory not found: ${DIR}" >&2; exit 1; }
shopt -s nullglob
dumps=( "${DIR}"/*.json.gz )
(( ${#dumps[@]} )) || { echo "FATAL: no *.json.gz dumps in ${DIR}" >&2; exit 1; }

UZ=zcat; command -v pigz >/dev/null && UZ="pigz -dc"
WORK="$(mktemp -d "${SORT_TMP}/stable_id_check.XXXXXX")"
trap 'rm -rf "${WORK}"' EXIT

echo "checking ${#dumps[@]} dumps in ${DIR}"

# ---- extract "<stable_id>\t<genome>" ---------------------------------------
# Dumps are one JSON object per line beginning with the _id. sed, not a JSON parser: parsing tens
# of GB of gene documents to read one field each would dominate the runtime.
#
# Per file we compare ids extracted against lines read. A dump whose format drifted would yield no
# ids and make this check pass VACUOUSLY, which is worse than not running it -- so the format is
# asserted per file rather than assumed.
for f in "${dumps[@]}"; do
  g="$(basename "${f}" .json.gz)"
  # One pass: emit "<id>\t<genome>" and report (lines, ids) on stderr so the format assertion
  # below costs no extra decompression. `{"_id":"` is 8 chars, and the match includes the closing
  # quote, so the id is substr(line, 9, RLENGTH-9).
  ${UZ} "${f}" | awk -v g="${g}" '
      { lines++
        if (match($0, /^\{"_id":"[^"]*"/)) { print substr($0, 9, RLENGTH - 9) "\t" g; ids++ } }
      END { printf "%d %d\n", lines, ids > "/dev/stderr" }' \
    2>"${WORK}/cnt" >> "${WORK}/all_ids.tsv"
  read -r lines ids < "${WORK}/cnt"
  [ "${lines:-0}" -gt 0 ] || { echo "FATAL: ${g}: dump is empty" >&2; exit 1; }
  if [ "${ids:-0}" != "${lines}" ]; then
    echo "FATAL: ${g}: extracted ${ids:-0} ids from ${lines} lines — unexpected dump format" >&2
    exit 1
  fi
done
total=$(wc -l < "${WORK}/all_ids.tsv")
echo "  ${total} gene stable ids extracted"

# ---- find ids claimed by more than one genome ------------------------------
LC_ALL=C sort -S "${SORT_MEM}" -T "${WORK}" -k1,1 "${WORK}/all_ids.tsv" > "${WORK}/sorted.tsv"
LC_ALL=C awk -F'\t' '
  function flush() { if (p != "" && n > 1) print p "\t" gs }
  { if ($1 != p) { flush(); p = $1; n = 1; gs = $2 }
    else { n++; gs = gs "," $2 } }
  END { flush() }' "${WORK}/sorted.tsv" > "${WORK}/dups.tsv"

n_dup=$(wc -l < "${WORK}/dups.tsv")
echo "  $(LC_ALL=C sort -u -k1,1 "${WORK}/sorted.tsv" | wc -l) distinct ids; ${n_dup} claimed by more than one genome"

if [ "${n_dup}" -eq 0 ]; then
  echo "no stable id collisions"
  exit 0
fi

# ---- group by genome set, apply the allow-list -----------------------------
# A listed pair still means genes are being dropped; listing only stops it blocking the build. An
# unlisted pair fails, so a newly introduced collision can never pass silently.
cut -f2 "${WORK}/dups.tsv" | LC_ALL=C sort | uniq -c | sort -rn > "${WORK}/pairs.txt"

norm() { echo "$1" | tr ',' '\n' | LC_ALL=C sort | paste -sd: -; }
allow_norm=""
if [ -n "${ALLOW_RAW}" ]; then
  allow_norm="$(echo "${ALLOW_RAW}" | tr ',' '\n' | while read -r p; do
      [ -n "${p}" ] && echo "${p}" | tr ':' '\n' | LC_ALL=C sort | paste -sd: -
    done)"
fi

blocking=0
echo
echo "${n_dup} colliding id(s) across $(wc -l < "${WORK}/pairs.txt") genome set(s):"
while read -r cnt gset; do
  key="$(norm "${gset}")"
  if [ -n "${allow_norm}" ] && echo "${allow_norm}" | grep -qxF "${key}"; then
    tag="[allowed] "
  else
    tag="[BLOCKING] "; blocking=$((blocking + cnt))
  fi
  echo "  ${tag}${gset//,/  <->  }"
  echo "      ${cnt} shared ids, e.g. $(awk -F'\t' -v s="${gset}" '$2==s{print $1; if(++i==5) exit}' "${WORK}/dups.tsv" | paste -sd, - | sed 's/,/, /g')"
done < "${WORK}/pairs.txt"

if [ "${blocking}" -eq 0 ]; then
  echo
  echo "all colliding sets are explicitly allow-listed via STABLE_ID_COLLISION_ALLOW"
  echo "NB genes are still being dropped for those pairs — this only stops it blocking."
  exit 0
fi

cat >&2 <<EOF

${blocking} gene(s) cannot be represented: two genomes claim the same stable id, and <db>.genes
keys on it, so one copy silently replaces the other.

A wrong stable-id prefix in a source core is the usual cause — compare the previous release's core
for the same assembly, which is how the triticum_aestivum_alchemy regression was found (r69 used
TraesALC*, r70 used the reference's TraesCS*). Otherwise decide per pair and record the decision in
STABLE_ID_COLLISION_ALLOW. See docs/04-troubleshooting.md.
EOF
exit 1

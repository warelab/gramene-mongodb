#!/usr/bin/env bash
# build_medicago_expression_lut.sh — crosswalk EBI Atlas's Mt4.0 medicago gene ids onto this
# release's ids, so medicago expression attaches instead of dangling.
#
# THE PROBLEM
# Expression Atlas keys medicago expression on MedtrA17_4.0 ids (MTR_1g004990 — see
# https://www.ebi.ac.uk/gxa/experiments/E-MTAB-3532/Results), because that is what Ensembl Plants
# published for medicago at the time. This release's medicago is MtrunA17r5.0_ANR. So all 51,519
# medicago expression documents 55_atlas loads are keyed on ids that match no gene in the build:
# the data is present and completely unjoinable. That is true before any Gramene id fix and is not
# caused by one.
#
# This is the same shape as the poplar/grapevine/barley cases project_expression_via_lut.js already
# handles; medicago simply had no LUT. Output is that script's format: <new_id>\t<old_id>.
#
# HOW THE MAPPING IS DERIVED
# No public Mt4.0 <-> MtrunA17r5.0 correspondence file exists (the Toulouse portal's ID Converter is
# interactive, with no bulk export found), so it is built from two INDEPENDENT local sources and
# their union taken:
#
#   1. identical protein sequence -- compara 66_108 holds Mt4.0 medicago (genome_db 2062) with
#      sequences, compara 70_116 holds r5.0 (genome_db 2282). Genes whose protein is byte-identical
#      are the same gene. 20,185 strictly 1:1 pairs.
#   2. shared NCBI GeneID -- both cores carry EntrezGene xrefs, and NCBI GeneIDs are stable across
#      assembly updates. 19,188 strictly 1:1 pairs.
#
# Where both methods map a gene they AGREE on 99.8% of cases (16,244 of 16,276), which is the
# cross-validation; the 32 disagreements are dropped by preferring protein identity. Union: 23,073.
#
# COVERAGE, STATED PLAINLY
# 23,073 of the 51,519 Atlas-keyed documents become joinable -- about 45%. The rest need either a
# bulk export of the Toulouse ID Converter or sequence-SIMILARITY matching (reciprocal best hits)
# rather than exact identity. Note 100% is not attainable in principle: the annotation went from
# 52,847 genes to 50,739, so some Mt4.0 genes have no r5.0 counterpart at all.
#
# usage: build_medicago_expression_lut.sh [outdir]
#   MYSQL_HOST/MYSQL_USER/MYSQL_PASS from build/config.sh
set -euo pipefail

OUT="${1:-/scratch/olson/legume_idmap}"
mkdir -p "$OUT"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MY="mysql -h ${MYSQL_HOST} -u ${MYSQL_USER} -p${MYSQL_PASS} -N -s"

OLD_CMP=ensembl_compara_plants_66_108   # Mt4.0  (MedtrA17_4.0)
NEW_CMP=ensembl_compara_plants_70_116   # r5.0   (MtrunA17r5.0_ANR)
OLD_GDB=2062
NEW_GDB=2282
OLD_CORE=medicago_truncatula_core_66_108_2
NEW_CORE=medicago_truncatula_core_70_116_3

# ---- 1. protein md5 per gene, both annotations -----------------------------
# Restrict by genome_db_id BEFORE hashing. Joining the sequence tables first makes MySQL MD5 all
# 8.4M sequences in the release and the query never returns.
for spec in "${OLD_CMP}:${OLD_GDB}:mt40" "${NEW_CMP}:${NEW_GDB}:mt50"; do
  db="${spec%%:*}"; rest="${spec#*:}"; gdb="${rest%%:*}"; tag="${rest##*:}"
  # s.md5sum, not MD5(s.sequence): compara already stores the digest. Computing it here is not
  # just wasteful, it is how an exploratory version of this query ended up running for 136 minutes
  # in "Copying to tmp table" and starving everything else on the server.
  ${MY} -D "${db}" -e "
    SELECT gm.stable_id, s.md5sum
      FROM seq_member sm
      JOIN sequence s ON sm.sequence_id = s.sequence_id
      JOIN gene_member gm ON gm.gene_member_id = sm.gene_member_id
     WHERE sm.genome_db_id = ${gdb};" > "${OUT}/${tag}_md5.tsv"
  echo "  ${tag}: $(wc -l < "${OUT}/${tag}_md5.tsv") proteins" >&2
done

# ---- 2. EntrezGene xref per gene, both annotations -------------------------
for spec in "${OLD_CORE}:mt40" "${NEW_CORE}:mt50"; do
  db="${spec%%:*}"; tag="${spec##*:}"
  ${MY} -D "${db}" -e "
    SELECT g.stable_id, x.dbprimary_acc
      FROM gene g
      JOIN object_xref ox ON ox.ensembl_id = g.gene_id AND ox.ensembl_object_type = 'Gene'
      JOIN xref x ON ox.xref_id = x.xref_id
      JOIN external_db e ON x.external_db_id = e.external_db_id
     WHERE e.db_name = 'EntrezGene';" > "${OUT}/${tag}_entrez.tsv"
  echo "  ${tag}: $(wc -l < "${OUT}/${tag}_entrez.tsv") EntrezGene xrefs" >&2
done

# ---- 3. join, cross-validate, compose -------------------------------------
OUT="${OUT}" python3 -I - <<'PY'
import os
from collections import defaultdict
OUT = os.environ['OUT']

def group(path):
    d = defaultdict(set)
    for line in open(path):
        f = line.rstrip('\n').split('\t')
        if len(f) == 2:
            d[f[1]].add(f[0])
    return d

def one_to_one(old, new):
    """Pairs where a key maps to exactly one gene on each side, kept strictly 1:1 overall."""
    out = {}
    seen_o, seen_n = set(), set()
    for k in sorted(set(old) & set(new)):
        if len(old[k]) != 1 or len(new[k]) != 1:
            continue                      # paralogs sharing a protein, or a split/merged gene
        o, n = next(iter(old[k])), next(iter(new[k]))
        if o in seen_o or n in seen_n:
            continue
        seen_o.add(o); seen_n.add(n); out[o] = n
    return out

seq = one_to_one(group(OUT + '/mt40_md5.tsv'), group(OUT + '/mt50_md5.tsv'))
ent = one_to_one(group(OUT + '/mt40_entrez.tsv'), group(OUT + '/mt50_entrez.tsv'))
both = set(seq) & set(ent)
agree = sum(1 for g in both if seq[g] == ent[g])
print("  protein identity: %d   NCBI GeneID: %d   both: %d   agreeing: %d (%.1f%%)"
      % (len(seq), len(ent), len(both), agree, agree / len(both) * 100 if both else 0))

# Prefer protein identity: it is direct evidence about the gene product, where a shared GeneID is
# NCBI's own curation call. The 32 disagreements resolve to the sequence answer.
union = {g: (v, 'protein_identity') for g, v in seq.items()}
for g, v in ent.items():
    union.setdefault(g, (v, 'ncbi_geneid'))
final, seen = {}, set()
for g, (v, m) in sorted(union.items()):
    if v in seen:
        continue
    seen.add(v); final[g] = (v, m)
print("  union, strictly 1:1 both sides: %d pairs" % len(final))

# project_expression_via_lut.js reads "<new_id>\t<old_id>". The new_id side comes straight out of
# compara's gene_member, which now holds the community ids -- the core/compara rename has been
# applied, so no geneNNNN indirection is needed. An earlier version of this script translated
# geneNNNN -> community id via legume_community_ids_features.tsv; that step is obsolete and was
# removed rather than left to silently produce nothing. Verified the pair set is unchanged either
# way: the same 23,073 mappings, just labelled with the ids the databases now use.
n = 0
with open(OUT + '/medicago_expression.lut.txt', 'w') as lut, \
     open(OUT + '/mt_crosswalk.tsv', 'w') as cw:
    for g, (v, m) in sorted(final.items()):
        cw.write('%s\t%s\t%s\n' % (g, v, m))
        lut.write('%s\t%s\n' % (v, g)); n += 1
stale = [v for v, _ in final.values() if not v.startswith('MtrunA17')]
if stale:
    print("  WARNING: %d new_ids are not MtrunA17_* -- is compara renamed? e.g. %s"
          % (len(stale), stale[:3]))
print("  LUT lines: %d" % n)
print("  wrote %s/medicago_expression.lut.txt and mt_crosswalk.tsv" % OUT)
PY

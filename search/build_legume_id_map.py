#!/usr/bin/env python3
"""build_legume_id_map.py — map Ensembl's generic gene ids to community gene ids.

WHY
Ensembl Plants imported the Medicago truncatula and Lablab purpureus annotations using the GFF3's
file-local `ID=` attribute (`ID=gene0`, `ID=rna0`) instead of the stable, citable identifier that
the submission carries elsewhere. Every gene in both genomes therefore has an id of the form
`geneNNNN`, which is not the identifier legume researchers use, is not citable, and -- because
Gramene keys gene documents on the stable id -- collides between the two genomes on 24,925 ids.

Ensembl Plants is frozen, so Gramene fixes this downstream and reports upstream. This produces the
lookup table that fix needs.

SOURCES AND JOIN KEYS (both exact, neither heuristic)

  medicago_truncatula -- INSDC, assembly GCA_003473485.2 (MtrunA17r5.0_ANR), cv. Jemalong A17
    The submission carries /locus_tag="MtrunA17_Chr4g0000001", the MtrunA17r5.0-ANR scheme from
    the Toulouse portal. Ensembl kept the GenBank /protein_id as its TRANSLATION stable id
    (RHN58223.1), and the feature table's protein_id line carries both keys at once:
        protein_id   gb|RHN76641.1||gnl|WGS:PSQE|MtrunA17_Chr1g0146101
    so ensembl_gene -> ensembl_translation -> protein accession -> locus_tag is exact. Genes with
    no translation (ncRNA etc.) fall back to an exact gene-extent match.

  lablab_purpureus -- LegumeInfo/LIS copy of the ILRI annotation, cv. Highworth, Highworth.gnm1.ann1
    Confirmed the same assembly: the INSDC record for GCA_030347555.1 reads "cultivar Highworth"
    and "Assembly Name :: ILRI_Lpur", built with Flye v2.7.1, as LIS records. (Ensembl labels this
    genome "Natoba", which appears to be wrong.)
    The native id is the GFF3 `Name=` attribute (Labpu01g000050). Ensembl's GENE bounds equal the
    LIS representative mRNA bounds -- not the LIS gene bounds -- because Ensembl imported one
    transcript per locus, so the join is on (accession, mRNA start, mRNA end, strand). LIS
    chromosome chrNN maps to CM0592(53+NN).1, verified by exact coordinate overlap with zero
    cross-matches.

Extras carried through, since they are better than what Ensembl holds: the Medicago /product, and
for lablab the GFF3 Note (a functional description; Ensembl has only 6 gene descriptions for this
genome), Dbxref and Ontology_term.

OUTPUT  a TSV with a header, one row per Ensembl gene.
"""
import gzip
import os
import re
import subprocess
import sys
import urllib.parse
from collections import defaultdict

W = os.environ.get('IDMAP_WORK', '/scratch/olson/legume_idmap')
OUT = os.environ.get('IDMAP_OUT', os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                               'legume_community_ids.tsv'))
MYSQL_HOST = os.environ.get('MYSQL_HOST', 'colden')
MYSQL_USER = os.environ.get('MYSQL_USER', 'gramene_web')
MYSQL_PASS = os.environ.get('MYSQL_PASS', '')
MT_DB = os.environ.get('MT_DB', 'medicago_truncatula_core_70_116_3')
LP_DB = os.environ.get('LP_DB', 'lablab_purpureus_gca030347555v1cm_core_70_116_1')
LIS_GFF = os.path.join(W, 'labpu.Highworth.gnm1.ann1.HJ3B.gene_models_main.gff3.gz')


def mysql(db, sql):
    """Rows as lists of strings. -N -s makes mysql tab-separate columns itself; do NOT build the
    separator with CONCAT('\\t',...), which emits a literal backslash-t here."""
    # NB python 3.6 on this host: no capture_output=, no text=
    p = subprocess.run(['mysql', '-h', MYSQL_HOST, '-u', MYSQL_USER, '-p' + MYSQL_PASS,
                        '-N', '-s', '-D', db, '-e', sql],
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                       universal_newlines=True)
    if p.returncode != 0:
        sys.exit('mysql failed on %s: %s' % (db, p.stderr.strip()[:400]))
    return [ln.split('\t') for ln in p.stdout.splitlines() if ln.strip()]


def ensembl_genes(db, generic_only=True):
    """gene stable_id, accession, start, end, strand, biotype, and its translation ids."""
    where = "WHERE g.stable_id REGEXP '^gene[0-9]+$'" if generic_only else ''
    rows = mysql(db, """
        SELECT g.stable_id, sr.name, g.seq_region_start, g.seq_region_end, g.seq_region_strand,
               g.biotype, IFNULL(GROUP_CONCAT(DISTINCT tl.stable_id),'')
          FROM gene g
          JOIN seq_region sr ON g.seq_region_id = sr.seq_region_id
          LEFT JOIN transcript t ON t.gene_id = g.gene_id
          LEFT JOIN translation tl ON tl.transcript_id = t.transcript_id
        %s
        GROUP BY g.gene_id;""" % where)
    return [r for r in rows if len(r) >= 7]


# --------------------------------------------------------------------------- medicago
# Feature table records look like:
#   14818<TAB>14017<TAB>gene
#   <TAB><TAB><TAB>locus_tag<TAB>MtrunA17_Chr1g0146101
#   ...
#   <TAB><TAB><TAB>protein_id<TAB>gb|RHN76641.1||gnl|WGS:PSQE|MtrunA17_Chr1g0146101
PROT_ACC = re.compile(r'gb\|([A-Z0-9_.]+)\|')


def parse_medicago_ft():
    prot2locus = {}                 # GenBank protein accession -> locus_tag
    extent2locus = {}               # (acc, min, max) -> locus_tag
    locus_product = {}              # locus_tag -> /product
    acc = None
    cur_locus = None
    cur_extent = None
    files = sorted(f for f in os.listdir(os.path.join(W, 'ft')) if f.endswith('.ft'))
    for fn in files:
        for line in open(os.path.join(W, 'ft', fn), errors='replace'):
            line = line.rstrip('\n')
            if line.startswith('>Feature'):
                m = re.search(r'gb\|([^|]+)\|', line)
                acc = m.group(1) if m else None
                cur_locus = cur_extent = None
                continue
            f = line.split('\t')
            if len(f) >= 3 and f[0] and f[1] and f[2]:
                # a feature header: start, end, key
                if f[2] == 'gene':
                    try:
                        a, b = int(f[0]), int(f[1])
                    except ValueError:
                        cur_extent = None
                    else:
                        cur_extent = (acc, str(min(a, b)), str(max(a, b)))
                    cur_locus = None
            elif len(f) >= 5 and not f[0] and not f[1]:
                key, val = f[3], f[4]
                if key == 'locus_tag':
                    cur_locus = val
                    if cur_extent:
                        extent2locus[cur_extent] = val
                elif key == 'protein_id':
                    m = PROT_ACC.search(val)
                    if m:
                        tail = val.rsplit('|', 1)[-1]
                        prot2locus[m.group(1)] = tail or cur_locus or ''
                elif key == 'product' and cur_locus and cur_locus not in locus_product:
                    locus_product[cur_locus] = val
    return prot2locus, extent2locus, locus_product


# --------------------------------------------------------------------------- lablab
def parse_lis_gff():
    """(acc, mrna_start, mrna_end, strand) -> (native_id, note, dbxref, ontology)"""
    gene_meta = {}
    key2native = defaultdict(list)
    chrmap = {'labpu.Highworth.gnm1.chr%02d' % i: 'CM0592%d.1' % (53 + i) for i in range(1, 12)}
    with gzip.open(LIS_GFF, 'rt', errors='replace') as fh:
        pending = []
        for line in fh:
            if line.startswith('#'):
                continue
            f = line.rstrip('\n').split('\t')
            if len(f) < 9:
                continue
            attrs = {}
            for kv in f[8].split(';'):
                if '=' in kv:
                    k, v = kv.split('=', 1)
                    attrs[k] = urllib.parse.unquote(v)
            if f[2] == 'gene':
                gene_meta[attrs.get('ID', '')] = (attrs.get('Name', ''), attrs.get('Note', ''),
                                                  attrs.get('Dbxref', ''), attrs.get('Ontology_term', ''))
            elif f[2] == 'mRNA':
                pending.append((chrmap.get(f[0], f[0]), f[3], f[4],
                                '1' if f[6] == '+' else '-1', attrs.get('Parent', '')))
    for acc, s, e, strand, parent in pending:
        meta = gene_meta.get(parent)
        if meta:
            key2native[(acc, s, e, strand)].append(meta)
    return key2native


def main():
    cols = ['species', 'ensembl_gene_id', 'community_gene_id', 'community_id_alternatives',
            'seq_region', 'start', 'end', 'strand', 'biotype', 'description', 'dbxref',
            'ontology_term', 'ensembl_translation', 'join_method', 'confidence']
    n = defaultdict(int)
    with open(OUT, 'w') as out:
        out.write('\t'.join(cols) + '\n')

        # ---- medicago ----
        prot2locus, extent2locus, locus_product = parse_medicago_ft()
        sys.stderr.write('medicago: %d protein->locus_tag, %d gene extents, %d products\n'
                         % (len(prot2locus), len(extent2locus), len(locus_product)))
        for gid, acc, s, e, strand, biotype, trans in ensembl_genes(MT_DB):
            native = ''
            method = conf = ''
            for t in [x for x in trans.split(',') if x]:
                if t in prot2locus:
                    native, method, conf = prot2locus[t], 'protein_id', 'exact'
                    break
            if not native:
                native = extent2locus.get((acc, s, e), '')
                if native:
                    method, conf = 'gene_extent', 'exact'
            n['mt_total'] += 1
            n['mt_' + (method or 'unmatched')] += 1
            out.write('\t'.join(['medicago_truncatula', gid, native, '', acc, s, e, strand, biotype,
                                 locus_product.get(native, ''), '', '', trans,
                                 method or 'none', conf or 'unmatched']) + '\n')

        # ---- lablab ----
        # Two passes, because 199 coordinate sets in the LIS annotation are shared by more than one
        # gene locus -- 198 of them with byte-identical exon structures, i.e. the same model given
        # two ids upstream. Every such group has exactly as many Ensembl genes as candidate ids
        # (187 2x2, 11 3x3, 1 4x4), so the candidates are dealt out 1:1 in sorted order. WHICH
        # duplicate gets which id is immaterial when the models are identical, but it must be
        # deterministic and it must stay unique -- handing every gene in a group the same
        # "first" candidate would manufacture a fresh collision, which is the bug being fixed.
        key2native = parse_lis_gff()
        sys.stderr.write('lablab: %d mRNA coordinate keys from LIS\n' % len(key2native))
        lp_rows = []
        groups = defaultdict(list)
        for gid, acc, s, e, strand, biotype, trans in ensembl_genes(LP_DB):
            k = (acc, s, e, strand)
            lp_rows.append([gid, acc, s, e, strand, biotype, trans, k])
            groups[k].append(gid)
        assigned = {}
        for k, gids in groups.items():
            uniq = sorted({h[0]: h for h in key2native.get(k, [])}.items())
            if len(uniq) > 1 and len(uniq) == len(gids):
                for gid, (name, meta) in zip(sorted(gids), uniq):
                    others = [nm for nm, _ in uniq if nm != name]
                    assigned[gid] = (name, meta, '|'.join(others), 'arbitrated_duplicate')
        for gid, acc, s, e, strand, biotype, trans, k in lp_rows:
            if gid in assigned:
                name, meta, alts, conf = assigned[gid]
                _, note, dbx, onto = meta
                method = 'mrna_coord'
            else:
                hits = {h[0]: h for h in key2native.get(k, [])}
                if len(hits) == 1:
                    name, (_, note, dbx, onto) = next(iter(hits.items()))
                    alts, method, conf = '', 'mrna_coord', 'exact'
                else:
                    name = '|'.join(sorted(hits)) if hits else ''
                    note = dbx = onto = alts = ''
                    method = 'mrna_coord' if hits else 'none'
                    conf = 'ambiguous' if hits else 'unmatched'
            n['lp_total'] += 1
            n['lp_' + conf] += 1
            out.write('\t'.join(['lablab_purpureus', gid, name, alts, acc, s, e, strand, biotype,
                                 note, dbx, onto, trans, method, conf]) + '\n')

    for k in sorted(n):
        sys.stderr.write('  %-18s %d\n' % (k, n[k]))
    sys.stderr.write('wrote %s\n' % OUT)


if __name__ == '__main__':
    main()

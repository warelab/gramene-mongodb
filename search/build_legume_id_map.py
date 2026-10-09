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
    # Both genomes are strictly one transcript per gene (verified: MAX(count)=1), so
    # GROUP_CONCAT yields a single value and the gene -> transcript -> translation chain is 1:1.
    rows = mysql(db, """
        SELECT g.stable_id, sr.name, g.seq_region_start, g.seq_region_end, g.seq_region_strand,
               g.biotype, IFNULL(GROUP_CONCAT(DISTINCT tl.stable_id),''),
               IFNULL(GROUP_CONCAT(DISTINCT t.stable_id),'')
          FROM gene g
          JOIN seq_region sr ON g.seq_region_id = sr.seq_region_id
          LEFT JOIN transcript t ON t.gene_id = g.gene_id
          LEFT JOIN translation tl ON tl.transcript_id = t.transcript_id
        %s
        GROUP BY g.gene_id;""" % where)
    return [r for r in rows if len(r) >= 8]


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
                # The native transcript id is the mRNA ID minus the datastore prefix. For lablab
                # the suffix is NOT always .1 (.1 x21390, .2 x1986, .3 x924, .4 x379, .5 x166),
                # because Ensembl imported whichever model LIS marked representative -- so this is
                # read, never derived.
                tx = attrs.get('ID', '').replace('labpu.Highworth.gnm1.ann1.', '')
                pending.append((chrmap.get(f[0], f[0]), f[3], f[4],
                                '1' if f[6] == '+' else '-1', attrs.get('Parent', ''), tx))
    for acc, s, e, strand, parent, tx in pending:
        meta = gene_meta.get(parent)
        if meta:
            key2native[(acc, s, e, strand)].append(meta + (tx,))
    return key2native


def load_tsv(path, default=None):
    d = {}
    if os.path.exists(path):
        for line in open(path, errors='replace'):
            f = line.rstrip('\n').split('\t')
            if len(f) >= 2:
                d[f[0]] = f[1]
    return d


def toulouse(locus_tag):
    """INSDC locus_tag -> the form the Toulouse portal and LegumeInfo publish, which differs only
    by the underscore: MtrunA17_Chr1g0146101 -> MtrunA17Chr1g0146101."""
    return locus_tag.replace('MtrunA17_', 'MtrunA17', 1) if locus_tag else ''


GENE_COLS = ['species', 'ensembl_gene_id', 'community_gene_id', 'community_id_alternatives',
             'gene_symbol', 'seq_region', 'start', 'end', 'strand', 'biotype', 'description',
             'dbxref', 'ontology_term', 'ensembl_transcript_id', 'community_transcript_id',
             'ensembl_translation_id', 'community_translation_id', 'join_method', 'confidence']
FEAT_COLS = ['species', 'feature_type', 'ensembl_id', 'community_id', 'community_id_alt',
             'parent_ensembl_gene', 'join_method', 'confidence']


def main():
    n = defaultdict(int)
    feat_path = OUT.replace('.tsv', '_features.tsv')
    gout = open(OUT, 'w')
    fout = open(feat_path, 'w')
    gout.write('\t'.join(GENE_COLS) + '\n')
    fout.write('\t'.join(FEAT_COLS) + '\n')

    def emit(species, gid, community, alts, symbol, acc, st, en, strand, biotype, desc, dbx, onto,
             etx, ctx, etl, ctl, ctx_alt, ctl_alt, method, conf):
        gout.write('\t'.join([species, gid, community, alts, symbol, acc, st, en, strand, biotype,
                               desc, dbx, onto, etx, ctx, etl, ctl, method, conf]) + '\n')
        fout.write('\t'.join([species, 'gene', gid, community, alts, gid, method, conf]) + '\n')
        if etx:
            fout.write('\t'.join([species, 'transcript', etx, ctx, ctx_alt, gid, method, conf]) + '\n')
        if etl:
            fout.write('\t'.join([species, 'translation', etl, ctl, ctl_alt, gid, method, conf]) + '\n')
        n[species + '_gene'] += 1
        n[species + '_transcript'] += 1 if etx else 0
        n[species + '_translation'] += 1 if etl else 0
        n[species + '_' + conf] += 1

    # ---- medicago ----
    prot2locus, extent2locus, locus_product = parse_medicago_ft()
    symbols = load_tsv(os.path.join(W, 'mt_symbols.tsv'))
    mt_tx = load_tsv(os.path.join(W, 'mt_tx.tsv'))
    sys.stderr.write('medicago: %d protein->locus_tag, %d extents, %d products, %d symbols, %d tx\n'
                     % (len(prot2locus), len(extent2locus), len(locus_product), len(symbols), len(mt_tx)))
    for gid, acc, st, en, strand, biotype, trans, tx in ensembl_genes(MT_DB):
        native = ''
        method = conf = ''
        tl_ids = [x for x in trans.split(',') if x]
        for t in tl_ids:
            if t in prot2locus:
                native, method, conf = prot2locus[t], 'protein_id', 'exact'
                break
        if not native:
            native = extent2locus.get((acc, st, en), '')
            if native:
                method, conf = 'gene_extent', 'exact'
        # All 44,623 LIS medicago mRNAs end in .1, so the transcript id is <gene>.1 without
        # ambiguity. Prefer the published Toulouse id where LIS covers the gene.
        ctx = native + '.1' if native else ''
        ctx_alt = mt_tx.get(native, (toulouse(native) + '.1') if native else '')
        emit('medicago_truncatula', gid, native, '', symbols.get(native, ''), acc, st, en, strand,
             biotype, locus_product.get(native, ''), '', '',
             tx, ctx, tl_ids[0] if tl_ids else '', ctx,
             ctx_alt, tl_ids[0] if tl_ids else '',
             method or 'none', conf or 'unmatched')

    # ---- lablab ----
    key2native = parse_lis_gff()
    sys.stderr.write('lablab: %d mRNA coordinate keys from LIS\n' % len(key2native))
    lp_rows = []
    groups = defaultdict(list)
    for gid, acc, st, en, strand, biotype, trans, tx in ensembl_genes(LP_DB):
        k = (acc, st, en, strand)
        lp_rows.append([gid, acc, st, en, strand, biotype, trans, tx, k])
        groups[k].append(gid)
    assigned = {}
    for k, gids in groups.items():
        uniq = sorted({h[0]: h for h in key2native.get(k, [])}.items())
        if len(uniq) > 1 and len(uniq) == len(gids):
            for g, (name, meta) in zip(sorted(gids), uniq):
                others = [nm for nm, _ in uniq if nm != name]
                assigned[g] = (name, meta, '|'.join(others), 'arbitrated_duplicate')
    for gid, acc, st, en, strand, biotype, trans, tx, k in lp_rows:
        if gid in assigned:
            name, meta, alts, conf = assigned[gid]
            _, note, dbx, onto, ntx = meta
            method = 'mrna_coord'
        else:
            hits = {h[0]: h for h in key2native.get(k, [])}
            if len(hits) == 1:
                name, (_, note, dbx, onto, ntx) = next(iter(hits.items()))
                alts, method, conf = '', 'mrna_coord', 'exact'
            else:
                name = '|'.join(sorted(hits)) if hits else ''
                note = dbx = onto = alts = ntx = ''
                method = 'mrna_coord' if hits else 'none'
                conf = 'ambiguous' if hits else 'unmatched'
        tl_ids = [x for x in trans.split(',') if x]
        emit('lablab_purpureus', gid, name, alts, '', acc, st, en, strand, biotype, note, dbx, onto,
             tx, ntx, tl_ids[0] if tl_ids else '', ntx, '', '', method, conf)

    gout.close()
    fout.close()
    for k in sorted(n):
        sys.stderr.write('  %-34s %d\n' % (k, n[k]))
    sys.stderr.write('wrote %s\n       %s\n' % (OUT, feat_path))


if __name__ == '__main__':
    main()

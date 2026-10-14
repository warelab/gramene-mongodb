#!/usr/bin/env python3
"""parse_legoo.py -- turn the LeGOO acronym spreadsheet into a normalised, gene-resolved TSV.

Reads Mt_gene_Acronyms_IDs_latest.xlsx, resolves each curated row to a gene in this release's
medicago core, and writes legoo_genes.tsv (plus legoo_unmatched.tsv for rows that do not resolve).
Everything downstream reads the TSV, so the spreadsheet is parsed exactly once.

Read-only against MySQL. Needs MYSQL_HOST/MYSQL_USER/MYSQL_PASS (source build/config.sh).

Why a hand-rolled xlsx reader: this host has python 3.6 with neither openpyxl nor pandas, and an
xlsx is a zip of XML, so xlsx_reader.py does it with the stdlib.

usage: parse_legoo.py <path to Mt_gene_Acronyms_IDs_latest.xlsx> [--core <db>]
"""
import io
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from xlsx_reader import read as read_xlsx

DEFAULT_CORE = 'medicago_truncatula_core_70_116_3'

# Column order in the 20220727 sheet. Verified against the header row rather than assumed; a
# future release that moves columns will fail the header check below instead of loading garbage.
COLS = [
    (0,  'Mt5.0 (r1.7) locus tag'),
    (1,  'ACRONYM'),
    (2,  'Mt5.0 (r1.9) locus tag (if new)'),
    (3,  'Mt5.0 (r1.8) locus tag (if new)'),
    (5,  'DESCRIPTION'),
    (6,  'Publication(s)'),
    (7,  'Mt5.0 (r1.6) locus tag'),
    (8,  'Mt4'),               # yes, the header cell really is just 'Mt4'
]
# Preference order when a row carries several revisions' locus tags. r1.7 first because it matches
# the core best (4,404 of 4,429 vs 4,402 for r1.6); the others only fill gaps.
ID_COLS = [0, 7, 2, 3]
NULLISH = {'', '#N/D', '#N/A', 'NA', 'n/a', '-'}


def mysql(sql, db=None):
    cmd = ['mysql', '-h', os.environ['MYSQL_HOST'], '-u', os.environ['MYSQL_USER'],
           '-p' + os.environ['MYSQL_PASS'], '-N', '-s']
    if db:
        cmd += ['-D', db]
    cmd += ['-e', sql]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                         universal_newlines=True)
    out, err = p.communicate()
    if p.returncode:
        sys.exit('mysql failed: ' + err.strip())
    return [l.split('\t') for l in out.splitlines()]


def clean(v):
    v = (v or '').strip()
    return '' if v in NULLISH else v


def pmids(cell):
    """'PMID:28438996|PMID:29030416' -> ['28438996', '29030416'], de-duplicated, order kept."""
    seen, out = set(), []
    for m in re.findall(r'\d{5,9}', clean(cell)):
        if m not in seen:
            seen.add(m)
            out.append(m)
    return out


def mt4_ids(cell):
    """LeGOO writes the JCVI spelling and may put several in one cell separated by ; or |.

    Translated to the NCBI spelling here: Expression Atlas and the Mt4.0 Ensembl core both use
    MTR_*, and Medtr* -> MTR_* is a verified pure prefix swap (4,034 of 4,074 resolve in
    medicago_truncatula_core_66_108_2, which has 51,519 MTR_* and zero Medtr*).
    """
    out = []
    for part in re.split(r'[;|,]', clean(cell)):
        part = part.strip()
        if part.startswith('Medtr'):
            out.append('MTR_' + part[len('Medtr'):])
        elif part.startswith('MTR_'):
            out.append(part)
    return out


def main():
    args = [a for a in sys.argv[1:]]
    core = DEFAULT_CORE
    if '--core' in args:
        i = args.index('--core')
        core = args[i + 1]
        del args[i:i + 2]
    if not args:
        sys.exit(__doc__)
    path = args[0]

    sheets = read_xlsx(path)
    name, rows = sheets[0]
    sys.stderr.write('sheet %r: %d rows\n' % (name, len(rows)))

    # Locate the header row rather than hardcoding row 3, and verify the columns are where we
    # expect. A silently reshaped spreadsheet is the one failure that would load wrong data into
    # the right columns, so this is a hard check.
    hdr_i = None
    for i, r in enumerate(rows[:10]):
        if r and r[0].strip().startswith('Mt5.0') and 'locus tag' in r[0]:
            hdr_i = i
            break
    if hdr_i is None:
        sys.exit('could not find the header row (expected one starting "Mt5.0 ... locus tag")')
    hdr = rows[hdr_i]
    for idx, expect in COLS:
        got = (hdr[idx] if idx < len(hdr) else '').strip()
        if got != expect:
            sys.exit('column %d is %r, expected %r -- the spreadsheet layout changed, refusing '
                     'to guess' % (idx, got, expect))
    sys.stderr.write('header row %d verified\n' % hdr_i)
    data = rows[hdr_i + 1:]

    # Current core state: which stable_ids exist, and which already carry a name/description.
    sys.stderr.write('reading %s ...\n' % core)
    core_genes = {}
    for row in mysql("SELECT g.gene_id, g.stable_id, "
                     "IF(g.display_xref_id IS NULL,0,1), "
                     "IF(g.description IS NULL OR g.description='',0,1) "
                     "FROM gene g WHERE g.stable_id LIKE 'MtrunA17\\_%'", core):
        if len(row) == 4:
            core_genes[row[1]] = (row[0], row[2] == '1', row[3] == '1')
    sys.stderr.write('  %d MtrunA17_* genes in core\n' % len(core_genes))
    if not core_genes:
        sys.exit('no MtrunA17_* genes in %s -- has the stable-id rename been applied?' % core)

    out = io.open('legoo_genes.tsv', 'w', encoding='utf-8')
    out.write(u'#stable_id\tgene_id\tacronym\tdescription\tpmids\tmtr_ids\t'
              u'has_name\thas_desc\tid_source\tprobes_affy\tprobes_nimblegen\n')
    bad = io.open('legoo_unmatched.tsv', 'w', encoding='utf-8')
    bad.write(u'#reason\tacronym\tcandidate_ids\n')

    seen = {}
    n_rows = n_ok = n_dup = 0
    for r in data:
        def g(i):
            return clean(r[i]) if i < len(r) else ''
        acronym = g(1)
        if not acronym:
            continue
        n_rows += 1
        stable_id, src = '', ''
        for idx in ID_COLS:
            cand = g(idx)
            if cand in core_genes:
                stable_id, src = cand, hdr[idx].strip()
                break
        if not stable_id:
            cands = [g(i) for i in ID_COLS if g(i)]
            bad.write(u'%s\t%s\t%s\n' % (
                'no_locus_tag' if not cands else 'not_in_core', acronym, ','.join(cands)))
            continue
        # One gene, several curated rows: keep the first and record the rest, rather than letting
        # a later row silently overwrite an earlier acronym.
        if stable_id in seen:
            n_dup += 1
            bad.write(u'duplicate_gene(kept %s)\t%s\t%s\n' % (seen[stable_id], acronym, stable_id))
            continue
        seen[stable_id] = acronym
        gene_id, has_name, has_desc = core_genes[stable_id]
        out.write(u'%s\n' % u'\t'.join([
            stable_id, gene_id, acronym, g(5),
            ','.join(pmids(r[6] if 6 < len(r) else '')),
            ','.join(mt4_ids(r[8] if 8 < len(r) else '')),
            '1' if has_name else '0', '1' if has_desc else '0', src,
            g(10), g(11),
        ]))
        n_ok += 1
    out.close()
    bad.close()

    sys.stderr.write('\nrows with an acronym:      %d\n' % n_rows)
    sys.stderr.write('resolved to a core gene:   %d\n' % n_ok)
    sys.stderr.write('  already have a name:     %d\n'
                     % sum(1 for sid in seen if core_genes[sid][1]))
    sys.stderr.write('  already have a desc:     %d\n'
                     % sum(1 for sid in seen if core_genes[sid][2]))
    sys.stderr.write('duplicate gene rows:       %d\n' % n_dup)
    sys.stderr.write('unresolved (see legoo_unmatched.tsv)\n')
    sys.stderr.write('wrote legoo_genes.tsv\n')


if __name__ == '__main__':
    main()

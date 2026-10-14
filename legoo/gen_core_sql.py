#!/usr/bin/env python3
"""gen_core_sql.py -- emit SQL that loads LeGOO annotation into the medicago core.

Generates four scripts in sql/ :

  01_legoo_preflight.sql  read-only. Every row must read OK; stop if any does not.
  02_legoo_backup.sql     copies every field the load modifies into legoo_bak_* tables.
  03_legoo_load.sql       the load itself.
  99_legoo_revert.sql     exact rollback, driven by those backup tables.

These tables are MyISAM: no transactions, no rollback. That is why the backup exists and why the
revert is generated at the same time as the load, from the same data, rather than reconstructed
later from memory.

WHAT IT WRITES
  external_db      one row for LeGOO, carrying the required citation in its description.
  xref             one row per curated gene (external_db LeGOO), plus one per distinct PubMed id.
  external_synonym the alternative acronyms LeGOO packs into one cell as "MtLb4|MtLb1|MtLb2".
  object_xref      links both kinds of xref to the gene.
  gene             display_xref_id ONLY where currently NULL; description ONLY where currently
                   NULL or empty. Existing annotation is never overwritten.

Nothing is renamed and compara is untouched, so no tree, homology or taxon id moves.

WHY dbprimary_acc IS THE STABLE ID, NOT THE ACRONYM
xref has a UNIQUE key on (dbprimary_acc, external_db_id, info_type, info_text, version), and 47
acronyms are shared by more than one gene, so acronym-as-accession would collide. Keying on the
stable id gives one xref per gene, which also keeps each gene's own description on its own row.
It also happens to be what the LeGOO portal's search box accepts, so the link resolves.

usage: gen_core_sql.py [--core <db>] [--out <dir>]
"""
import io
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_CORE = 'medicago_truncatula_core_70_116_3'
TSV = os.path.join(HERE, 'legoo_genes.tsv')

LEGOO_RELEASE = '20220727'
INFO_TEXT = 'LeGOO ' + LEGOO_RELEASE
CITATION = ('Curated Medicago truncatula gene acronyms, descriptions and publications from LeGOO '
            'release ' + LEGOO_RELEASE + '. Cite: S. Carrere, M. Verdenaud, C. Gough, J. Gouzy, '
            'P. Gamas. LeGOO: An Expertized Knowledge Database for the Model Legume Medicago '
            'truncatula. Plant and Cell Physiology 61(1):203-211, 2020. '
            'doi:10.1093/pcp/pcz177')
PUBMED_DB_NAME = 'PUBMED'


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


def q(s):
    """Quote for MySQL. Escapes backslash and quote; strips control characters."""
    if s is None:
        return 'NULL'
    s = ''.join(ch for ch in s if ord(ch) >= 32 or ch == '\t')
    s = s.replace('\\', '\\\\').replace("'", "\\'").replace('\t', ' ')
    return "'" + s + "'"


def chunks(seq, n=500):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def main():
    args = sys.argv[1:]
    core, outdir = DEFAULT_CORE, os.path.join(HERE, 'sql')
    if '--core' in args:
        i = args.index('--core'); core = args[i + 1]; del args[i:i + 2]
    if '--out' in args:
        i = args.index('--out'); outdir = args[i + 1]; del args[i:i + 2]
    if not os.path.isdir(outdir):
        os.makedirs(outdir)
    if not os.path.exists(TSV):
        sys.exit('%s missing -- run parse_legoo.py first' % TSV)

    # --- id blocks, allocated from the live maxima -------------------------------------------
    maxes = mysql("SELECT (SELECT IFNULL(MAX(xref_id),0) FROM xref), "
                  "(SELECT IFNULL(MAX(object_xref_id),0) FROM object_xref), "
                  "(SELECT IFNULL(MAX(external_db_id),0) FROM external_db)", core)[0]
    xref_base = int(maxes[0]) + 1000
    oxref_base = int(maxes[1]) + 1000
    legoo_db_id = int(maxes[2]) + 1
    pubmed = mysql("SELECT external_db_id FROM external_db WHERE db_name=%s" % q(PUBMED_DB_NAME),
                   core)
    if not pubmed:
        sys.exit('no %s external_db in %s' % (PUBMED_DB_NAME, core))
    pubmed_db_id = int(pubmed[0][0])
    sys.stderr.write('xref ids from %d, object_xref ids from %d, LeGOO external_db_id %d, '
                     'PUBMED %d\n' % (xref_base, oxref_base, legoo_db_id, pubmed_db_id))

    # --- read the parsed rows ------------------------------------------------------------------
    genes = []
    for i, ln in enumerate(io.open(TSV, encoding='utf-8')):
        if i == 0 or not ln.strip():
            continue
        f = (ln.rstrip('\n').split('\t') + [''] * 11)[:11]
        acro_cell = f[2]
        names = [a.strip() for a in acro_cell.split('|') if a.strip()]
        if not names:
            continue
        genes.append({
            'stable_id': f[0], 'gene_id': int(f[1]),
            'name': names[0], 'synonyms': names[1:],
            'description': f[3],
            'pmids': [p for p in f[4].split(',') if p],
            'has_name': f[6] == '1', 'has_desc': f[7] == '1',
        })
    if not genes:
        sys.exit('no rows in %s' % TSV)

    # one xref per gene; one shared xref per distinct PubMed id
    for n, g in enumerate(genes):
        g['xref_id'] = xref_base + n
    pmid_xref, nxt = {}, xref_base + len(genes)
    for g in genes:
        for p in g['pmids']:
            if p not in pmid_xref:
                pmid_xref[p] = nxt
                nxt += 1

    set_name = [g for g in genes if not g['has_name']]
    set_desc = [g for g in genes if not g['has_desc'] and g['description']]
    syn_rows = [(g, s) for g in genes for s in g['synonyms']]
    ox_gene = [(g['gene_id'], g['xref_id']) for g in genes]
    ox_pmid = [(g['gene_id'], pmid_xref[p]) for g in genes for p in g['pmids']]
    xref_hi = nxt - 1
    oxref_hi = oxref_base + len(ox_gene) + len(ox_pmid) - 1

    counts = {
        'genes': len(genes), 'legoo_xrefs': len(genes), 'pmid_xrefs': len(pmid_xref),
        'synonyms': len(syn_rows), 'object_xrefs': len(ox_gene) + len(ox_pmid),
        'set_display_xref': len(set_name), 'set_description': len(set_desc),
    }
    for k in ('genes', 'legoo_xrefs', 'pmid_xrefs', 'synonyms', 'object_xrefs',
              'set_display_xref', 'set_description'):
        sys.stderr.write('  %-18s %d\n' % (k, counts[k]))

    hdr = ("-- GENERATED by legoo/gen_core_sql.py -- do not edit by hand.\n"
           "-- target: %s    LeGOO release: %s\n"
           "-- These tables are MyISAM: no transactions. Run 02_legoo_backup.sql before\n"
           "-- 03_legoo_load.sql, or 99_legoo_revert.sql cannot restore exactly.\n\n"
           % (core, LEGOO_RELEASE))

    # --- 01 preflight --------------------------------------------------------------------------
    w = io.open(os.path.join(outdir, '01_legoo_preflight.sql'), 'w', encoding='utf-8')
    w.write(hdr)
    w.write("-- Every row must read OK. Anything else: stop and re-generate.\n\n")
    w.write("SELECT IF(COUNT(*)=0,'OK','ABORT: LeGOO external_db already present') AS legoo_db_free\n"
            "  FROM external_db WHERE db_name='LeGOO' OR external_db_id=%d;\n\n" % legoo_db_id)
    w.write("SELECT IF(COUNT(*)=0,'OK','ABORT: xref id block occupied') AS xref_block_free\n"
            "  FROM xref WHERE xref_id BETWEEN %d AND %d;\n\n" % (xref_base, xref_hi))
    w.write("SELECT IF(COUNT(*)=0,'OK','ABORT: object_xref id block occupied') AS oxref_block_free\n"
            "  FROM object_xref WHERE object_xref_id BETWEEN %d AND %d;\n\n"
            % (oxref_base, oxref_hi))
    w.write("SELECT IF(COUNT(*)=0,'OK','ABORT: a previous LeGOO load is present') AS not_loaded\n"
            "  FROM xref WHERE info_text=%s;\n\n" % q(INFO_TEXT))
    w.write("-- The %d genes must all still exist with the stable_id the parse resolved.\n"
            % len(genes))
    w.write("SELECT IF(COUNT(*)=%d,'OK',CONCAT('ABORT: expected %d genes, found ',COUNT(*))) "
            "AS genes_present\n  FROM gene WHERE gene_id IN (%s);\n\n"
            % (len(genes), len(genes), ','.join(str(g['gene_id']) for g in genes)))
    w.write("-- Nothing we are about to set should already be set (the load skips these anyway;\n"
            "-- a non-zero count here means the core changed since the parse).\n")
    w.write("SELECT IF(COUNT(*)=0,'OK',CONCAT('WARN: ',COUNT(*),' already have a name')) "
            "AS names_free\n  FROM gene WHERE display_xref_id IS NOT NULL AND gene_id IN (%s);\n\n"
            % ','.join(str(g['gene_id']) for g in set_name))
    if set_desc:
        w.write("SELECT IF(COUNT(*)=0,'OK',CONCAT('WARN: ',COUNT(*),' already have a description'))"
                " AS descs_free\n  FROM gene WHERE description IS NOT NULL AND description<>'' "
                "AND gene_id IN (%s);\n\n" % ','.join(str(g['gene_id']) for g in set_desc))
    w.close()

    # --- 02 backup -----------------------------------------------------------------------------
    w = io.open(os.path.join(outdir, '02_legoo_backup.sql'), 'w', encoding='utf-8')
    w.write(hdr)
    w.write("DROP TABLE IF EXISTS legoo_bak_gene_display_xref;\n")
    w.write("CREATE TABLE legoo_bak_gene_display_xref (\n"
            "  gene_id INT(10) UNSIGNED NOT NULL PRIMARY KEY,\n"
            "  display_xref_id INT(10) UNSIGNED DEFAULT NULL\n) ENGINE=MyISAM;\n")
    w.write("INSERT INTO legoo_bak_gene_display_xref (gene_id, display_xref_id)\n"
            "  SELECT gene_id, display_xref_id FROM gene WHERE gene_id IN (%s);\n\n"
            % ','.join(str(g['gene_id']) for g in set_name))
    w.write("DROP TABLE IF EXISTS legoo_bak_gene_description;\n")
    w.write("CREATE TABLE legoo_bak_gene_description (\n"
            "  gene_id INT(10) UNSIGNED NOT NULL PRIMARY KEY,\n"
            "  description TEXT\n) ENGINE=MyISAM;\n")
    if set_desc:
        w.write("INSERT INTO legoo_bak_gene_description (gene_id, description)\n"
                "  SELECT gene_id, description FROM gene WHERE gene_id IN (%s);\n\n"
                % ','.join(str(g['gene_id']) for g in set_desc))
    w.write("SELECT 'display_xref rows backed up', COUNT(*) FROM legoo_bak_gene_display_xref;\n")
    w.write("SELECT 'description rows backed up',  COUNT(*) FROM legoo_bak_gene_description;\n")
    w.close()

    # --- 03 load -------------------------------------------------------------------------------
    w = io.open(os.path.join(outdir, '03_legoo_load.sql'), 'w', encoding='utf-8')
    w.write(hdr)
    w.write("-- Fails rather than duplicating if re-run: every id is explicit, so a second run\n"
            "-- collides on the primary key.\n\n")
    w.write("SELECT IF((SELECT COUNT(*) FROM legoo_bak_gene_display_xref)=%d,'backup present',\n"
            "  'ABORT: run 02_legoo_backup.sql first') AS backup_check;\n\n" % len(set_name))

    w.write("INSERT INTO external_db (external_db_id, db_name, db_release, status, priority,\n"
            "                         db_display_name, type, secondary_db_name,\n"
            "                         secondary_db_table, description)\n"
            "  VALUES (%d, 'LeGOO', %s, 'KNOWNXREF', 260, 'LeGOO gene acronym',\n"
            "          'PRIMARY_DB_SYNONYM', NULL, NULL, %s);\n\n"
            % (legoo_db_id, q(LEGOO_RELEASE), q(CITATION)))

    w.write("-- one xref per curated gene: accession = stable_id (unique), label = acronym\n")
    for batch in chunks(genes):
        w.write("INSERT INTO xref (xref_id, external_db_id, dbprimary_acc, display_label,\n"
                "                  version, description, info_type, info_text) VALUES\n")
        w.write(',\n'.join(
            "  (%d,%d,%s,%s,'',%s,'DIRECT',%s)"
            % (g['xref_id'], legoo_db_id, q(g['stable_id']), q(g['name']),
               q(g['description']) if g['description'] else 'NULL', q(INFO_TEXT))
            for g in batch))
        w.write(";\n")
    w.write("\n")

    if pmid_xref:
        w.write("-- one shared xref per distinct PubMed id\n")
        items = sorted(pmid_xref.items(), key=lambda kv: kv[1])
        for batch in chunks(items):
            w.write("INSERT INTO xref (xref_id, external_db_id, dbprimary_acc, display_label,\n"
                    "                  version, description, info_type, info_text) VALUES\n")
            w.write(',\n'.join(
                "  (%d,%d,%s,%s,'',NULL,'DIRECT',%s)"
                % (xid, pubmed_db_id, q(p), q(p), q(INFO_TEXT)) for p, xid in batch))
            w.write(";\n")
        w.write("\n")

    if syn_rows:
        w.write("-- alternative acronyms LeGOO packs into one cell, e.g. 'MtLb4|MtLb1|MtLb2'\n")
        for batch in chunks(syn_rows):
            w.write("INSERT INTO external_synonym (xref_id, synonym) VALUES\n")
            w.write(',\n'.join("  (%d,%s)" % (g['xref_id'], q(s[:100])) for g, s in batch))
            w.write(";\n")
        w.write("\n")

    w.write("-- object_xref: analysis_id NULL on purpose -- provenance is external_db + info_text,\n"
            "-- and borrowing another analysis's id would misattribute these rows.\n")
    allox = [(oxref_base + i, gid, xid)
             for i, (gid, xid) in enumerate(ox_gene + ox_pmid)]
    for batch in chunks(allox):
        w.write("INSERT INTO object_xref (object_xref_id, ensembl_id, ensembl_object_type,\n"
                "                         xref_id, linkage_annotation, analysis_id) VALUES\n")
        w.write(',\n'.join("  (%d,%d,'Gene',%d,NULL,NULL)" % (oid, gid, xid)
                           for oid, gid, xid in batch))
        w.write(";\n")
    w.write("\n")

    w.write("-- display name, only where the gene has none\n")
    for batch in chunks(set_name, 200):
        w.write("UPDATE gene SET display_xref_id = CASE gene_id\n")
        for g in batch:
            w.write("    WHEN %d THEN %d\n" % (g['gene_id'], g['xref_id']))
        w.write("  END\n WHERE display_xref_id IS NULL AND gene_id IN (%s);\n"
                % ','.join(str(g['gene_id']) for g in batch))
    w.write("\n")

    if set_desc:
        w.write("-- description, only where the gene has none. Ensembl's [Source:...;Acc:...] form.\n")
        for batch in chunks(set_desc, 200):
            w.write("UPDATE gene SET description = CASE gene_id\n")
            for g in batch:
                w.write("    WHEN %d THEN %s\n"
                        % (g['gene_id'],
                           q('%s [Source:LeGOO;Acc:%s]' % (g['description'], g['name']))))
            w.write("  END\n WHERE (description IS NULL OR description='') AND gene_id IN (%s);\n"
                    % ','.join(str(g['gene_id']) for g in batch))
        w.write("\n")

    w.write("-- verification\n")
    w.write("SELECT 'LeGOO xrefs',      COUNT(*), %d FROM xref WHERE external_db_id=%d;\n"
            % (counts['legoo_xrefs'], legoo_db_id))
    w.write("SELECT 'PubMed xrefs',     COUNT(*), %d FROM xref\n"
            " WHERE external_db_id=%d AND info_text=%s;\n"
            % (counts['pmid_xrefs'], pubmed_db_id, q(INFO_TEXT)))
    w.write("SELECT 'synonyms',         COUNT(*), %d FROM external_synonym\n"
            " WHERE xref_id BETWEEN %d AND %d;\n"
            % (counts['synonyms'], xref_base, xref_hi))
    w.write("SELECT 'object_xrefs',     COUNT(*), %d FROM object_xref\n"
            " WHERE object_xref_id BETWEEN %d AND %d;\n"
            % (counts['object_xrefs'], oxref_base, oxref_hi))
    w.write("SELECT 'genes named',      COUNT(*), %d FROM gene\n"
            " WHERE display_xref_id BETWEEN %d AND %d;\n"
            % (counts['set_display_xref'], xref_base, xref_hi))
    w.write("SELECT 'genes described',  COUNT(*), %d FROM gene\n"
            " WHERE description LIKE '%%[Source:LeGOO;%%';\n" % counts['set_description'])
    w.close()

    # --- 99 revert -----------------------------------------------------------------------------
    w = io.open(os.path.join(outdir, '99_legoo_revert.sql'), 'w', encoding='utf-8')
    w.write(hdr)
    w.write("-- Exact rollback. Needs the legoo_bak_* tables from 02_legoo_backup.sql.\n\n")
    w.write("SELECT IF((SELECT COUNT(*) FROM information_schema.tables\n"
            "            WHERE table_schema=DATABASE()\n"
            "              AND table_name='legoo_bak_gene_display_xref')=1,\n"
            "          'backup present','ABORT: backup table missing') AS backup_check;\n\n")
    w.write("-- 1. detach the display names before the xrefs go\n")
    w.write("UPDATE gene g JOIN legoo_bak_gene_display_xref b USING (gene_id)\n"
            "   SET g.display_xref_id = b.display_xref_id;\n\n")
    w.write("-- 2. restore descriptions\n")
    w.write("UPDATE gene g JOIN legoo_bak_gene_description b USING (gene_id)\n"
            "   SET g.description = b.description;\n\n")
    w.write("-- 3. remove what we inserted, by explicit id range\n")
    w.write("DELETE FROM object_xref WHERE object_xref_id BETWEEN %d AND %d;\n"
            % (oxref_base, oxref_hi))
    w.write("DELETE FROM external_synonym WHERE xref_id BETWEEN %d AND %d;\n"
            % (xref_base, xref_hi))
    w.write("DELETE FROM xref WHERE xref_id BETWEEN %d AND %d;\n" % (xref_base, xref_hi))
    w.write("DELETE FROM external_db WHERE external_db_id=%d AND db_name='LeGOO';\n\n"
            % legoo_db_id)
    w.write("-- 4. confirm nothing of ours is left\n")
    w.write("SELECT 'xrefs left (want 0)',        COUNT(*) FROM xref WHERE info_text=%s;\n"
            % q(INFO_TEXT))
    w.write("SELECT 'object_xrefs left (want 0)', COUNT(*) FROM object_xref\n"
            " WHERE object_xref_id BETWEEN %d AND %d;\n" % (oxref_base, oxref_hi))
    w.write("SELECT 'genes still named by us (want 0)', COUNT(*) FROM gene\n"
            " WHERE display_xref_id BETWEEN %d AND %d;\n" % (xref_base, xref_hi))
    w.write("\n-- 5. only once the counts above are 0\n")
    w.write("-- DROP TABLE legoo_bak_gene_display_xref;\n")
    w.write("-- DROP TABLE legoo_bak_gene_description;\n")
    w.close()

    sys.stderr.write('\nwrote %s/{01_legoo_preflight,02_legoo_backup,03_legoo_load,'
                     '99_legoo_revert}.sql\n' % outdir)


if __name__ == '__main__':
    main()

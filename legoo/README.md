# LeGOO Medicago annotation loader

Loads curated *Medicago truncatula* gene annotation from LeGOO into this release's medicago core
and expression LUT. Ensembl Plants ships this genome with essentially no gene annotation — of
50,739 genes, **452 have a name and 113 have a description** — so this is the largest annotation
gain available for medicago.

## Source

`Mt_gene_Acronyms_IDs_latest.xlsx`, LeGOO release **20220727**, from the INRAE/Toulouse Medicago
portal (<https://medicago.toulouse.inra.fr/MtrunA17r5.0-ANR/>). 4,522 curated genes carrying
acronyms, descriptions, publications, locus tags for Mt5.0 revisions r1.6-r1.9, Mt4.0 ids, and
Affymetrix/Nimblegen probe ids.

**Citation is required.** It is recorded in the `external_db` row this loader creates, so the
obligation travels with the data rather than living only in a commit message:

> S. Carrère, M. Verdenaud, C. Gough, J. Gouzy, P. Gamas. LeGOO: An Expertized Knowledge Database
> for the Model Legume *Medicago truncatula*. *Plant and Cell Physiology* 61(1):203-211, January
> 2020. <https://doi.org/10.1093/pcp/pcz177>

The probe columns are parsed but **not loaded** — nothing in Gramene consumes probe-level
identifiers today. They are carried into `legoo_genes.tsv` so a future consumer needs no re-parse.

## Why this is low risk

Unlike the stable-id rename this release also carries, nothing here is rewritten in place:

* new `xref`, `object_xref` and `external_db` rows;
* `gene.display_xref_id` set **only** where it is currently NULL;
* `gene.description` set **only** where it is currently NULL or empty.

Compara stores no gene names or descriptions, so compara is untouched and no tree, homology or
taxon id moves. These tables are MyISAM, so there are no transactions and no rollback — hence
`02_legoo_backup.sql` captures every field the load modifies and `99_legoo_revert.sql` restores
them exactly. Run the backup; a revert without it cannot be exact.

## Decisions taken

* **Existing names are never overwritten.** 201 of the 4,404 matched genes already have a
  `display_xref`; they keep it. Their LeGOO acronym is still inserted as an xref, so it remains
  searchable and its provenance is recorded — only `display_xref_id` is left alone. The other
  4,203 genes get the LeGOO acronym as their display name.
* **Where LeGOO and our derived Mt4.0 mapping disagree, ours wins.** Of 3,030 genes present in
  both, 99.3% agree (21 disagreements) — two independent methods cross-validating, since ours came
  from protein identity and NCBI GeneIDs (see `../atlas/build_medicago_expression_lut.sh`). The
  disagreements are mostly adjacent gene models, and at least one is a LeGOO error:
  for `MtrunA17_Chr3g0119041` LeGOO gives `MTR_5g079850` while our `MTR_3g079850` is
  chromosome-consistent. Curation is not automatically authoritative, so conflicts are reported
  and skipped rather than merged.
* **Mt4.0 ids are translated `Medtr*` -> `MTR_*`.** LeGOO uses the JCVI spelling; Expression Atlas
  and the Mt4.0 Ensembl core use the NCBI one. Verified a pure prefix swap: 4,034 of 4,074 LeGOO
  Mt4.0 ids resolve in `medicago_truncatula_core_66_108_2`, which holds 51,519 `MTR_*` genes and
  zero `Medtr*`.
* **Row-to-gene resolution prefers r1.7, then r1.6, r1.9, r1.8.** 4,404 of 4,434 distinct ids
  resolve against the core (99.4%). `#N/D` cells are skipped.

## Usage

Needs `MYSQL_HOST`/`MYSQL_USER`/`MYSQL_PASS` from `build/config.sh`. The parse and the expression
step are read-only against MySQL; only the generated SQL writes, and it needs a writer account
(the build's `gramene_web` is read-only).

```bash
. /usr/local/gramene/release70/build/config.sh

# 1. parse + resolve against the core  -> legoo_genes.tsv, legoo_unmatched.tsv
python3 -I parse_legoo.py /path/to/Mt_gene_Acronyms_IDs_latest.xlsx

# 2. expression mappings -> appends to ../atlas/new_old.lut.txt (backs it up first)
python3 -I add_expression_mappings.py

# 3. core SQL -> sql/0{1,2,3}_*.sql and sql/99_legoo_revert.sql
python3 -I gen_core_sql.py
```

Then, as a writer, in order:

```bash
mysql -h <host> -u <writer> -p <db> < sql/01_legoo_preflight.sql   # read-only, must pass
mysql -h <host> -u <writer> -p <db> < sql/02_legoo_backup.sql
mysql -h <host> -u <writer> -p <db> < sql/03_legoo_load.sql
```

## Getting it into the search index

`gene.display_xref_id` and `gene.description` are read by `40_genes_dump`, so the search index does
not see this until medicago is re-dumped. A full `50_genes_decorate` re-run costs hours on 16.1M
genes for the sake of 4,404 documents, so the cheap path is to patch those documents in
`search70.genes` directly and let `60_solr` index them. Because the core is updated too, the next
full rebuild regenerates the same result from source, so this creates no drift.

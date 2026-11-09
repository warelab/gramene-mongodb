# JGI expression loader

Loads the JGI/Phytozome sorghum expression study (Mullet lab, Texas A&M) into the
`experiments` / `assays` / `expression` collections. This is the **first non-EBI expression
source** in Gramene, so unlike `../atlas/` it *merges into* those collections rather than
building them.

Run it as build stage `57_jgi_expression`, between `55_atlas` (which **drops** all three
collections) and `58_expression_attributes` (which derives from them):

```bash
JGI_TARGET_DB=sorghum11 bash build/stages/57_jgi_expression.sh
```

`JGI_TARGET_DB` defaults to the build's `MONGO_DB`. This study is sorghum-only, so a subsite
build points it at its own database instead of `search<N>`.

The stage is idempotent — accessions and group ids are assigned deterministically and every
write is an upsert/merge, so re-running changes nothing.

## Which build tree

This loader lives in two checkouts of `gramene-mongodb` (branches `release70` and `sorghum_v11`).
**The sorghum subsite tree is the one that drives `sorghum11`:**

    /usr/local/gramene/subsites/sorghum/v11/     MONGO_DB=sorghum11   <- serves data.sorghumbase.org
    /usr/local/gramene/release70/                MONGO_DB=search70    <- main Gramene release

Stage 57 is wired into the v11 `Makefile` between 56 and 58, so `make refresh-expression`
re-runs it after `55_atlas` drops the collections. Without that the JGI data would be silently
lost on every expression refresh.

Two things must stay in sync across both trees when they change:
`tissue_po_map.tsv` / `condition_map.tsv`, and the `po_map.py` additions listed below. The two
`po_map.py` copies are **not** identical for unrelated reasons (v11 carries poplar xylem/phloem
vasculature terms that release70 lacks), so port changes additively rather than copying the file.

## Source

Three published Google Sheets (downloaded and cached in `tmp/`):

| file | rows | grain |
|---|---|---|
| `samples.csv` | 99 | sample group + prose description |
| `libraries.csv` | 288 | sequencing library, with SRA run/study, tissue, condition, PI |
| `tpm.csv` | 34,129 genes x 99 groups | **group-mean** TPM, one value per cell |

The 99 TPM column names are set-equal to the 99 `group` values in `libraries.csv`.
90 groups have 3 replicates, 9 have 2. One species, *Sorghum bicolor*, Phytozome
Sbicolor v3.1.1 (= `GCA_000003195.3`, the assembly Gramene's `sorghum_bicolor` genes sit on).

## What it produces

Four `Baseline` experiments, `source: "JGI"`:

| accession | JGI experiment | groups | libraries |
|---|---|---|---|
| `JGI-SB-1` | `developmental.stages` | 31 | 88 |
| `JGI-SB-2` | `internode.timecourse` | 46 | 136 |
| `JGI-SB-3` | `nitrogen` | 10 | 30 |
| `JGI-SB-4` | `standard.tissue` | 12 | 34 |

99 assays, and a `JGI-SB-n` key merged onto 34,118 existing `expression` gene documents.

## Undoing a load

`unload_jgi.js` reverses the stage — it strips the `JGI-SB-*` keys from the expression documents
and deletes the JGI experiments and assays, leaving the EBI data untouched:

```bash
mongosh "mongodb://localhost:27017/sorghum11" gramene-mongodb/jgi/unload_jgi.js
```

Re-run `58_expression_attributes` (and 60/62/65) afterwards, same as for a load.

## Curator-editable tables

Everything species- or study-specific lives in two TSVs, **not** in code:

- **`tissue_po_map.tsv`** — the 40 JGI tissue names -> an `organism part` label + PO id.
  This is the file that matters most. `expr_lib.py` assigns a gene's organ from
  `organism part` **and nothing else**, so a tissue with no PO id here contributes to no
  organ, silently. The loader refuses to run if any row is missing a PO id.
  Rows marked `REVIEW` in the `note` column are proposals, not established mappings.
- **`condition_map.tsv`** — the 39 `(experiment, condition)` pairs -> a typed characteristic.
  The source `condition` column is overloaded: it holds developmental stage, nitrogen
  treatment, timepoint, and internode sub-region depending on the experiment. PO ids here are
  advisory; only `organism part` drives the organ panel.

Internode sub-regions (`inner_core`, `middle_core`, `outer_core`, `epithelial`) deliberately
become a `sampling site` characteristic rather than refining `organism part`, so they cannot
disturb organ assignment. (`epithelial` would be especially dangerous as an organism part:
`po_map.EXCLUDE_LABELS` drops `epidermis`.)

## Gene ids

No string munging: Gramene already carries the Phytozome id as an alt_id
(`SORBI_3001G000100` -> `alt_id: ["Sb01g000200","Sobic.001G000100"]`). The stage builds the
map from `genes.alt_id` and asserts it is 1:1 and consistent with the naive
`Sobic.X -> SORBI_3X` transform, then dies if either check fails.

**11 of 34,129 matrix genes do not map** — `Sobic.K029400`, `K031400`, `K031900`, `K032200`,
`K032300`, `K032350`, `K032400`, `K032500`, `K032600`, `K043600`, `K043700`. These are
unplaced-scaffold loci present in Phytozome v3.1.1 but absent from the annotation Gramene
uses. They are written to `tmp/unmapped_genes.txt` and skipped. Coverage is 34,118/34,129.

Note the two gene counts that show up downstream: sorghum has **35,479** genes with expression
(34,118 `SORBI_*` + 1,361 `ENSRNA*` ncRNAs). The JGI matrix covers only the 34,118 Phytozome
protein-coding loci, so the ncRNAs correctly keep EBI-only data. `58_expression_attributes`
still expects 35,479 lines for sorghum -- that invariant is unaffected by this load.

## Why not reuse `../atlas/parseData.js`

It starts at column index 2 (GXA TSVs carry a Gene Name column; this matrix does not) and
does `split(',')[2]` because GXA cells hold five comma-separated quartiles — a plain `0.441`
would yield `NaN`. It is also `insertMany`, which cannot add a key to an existing gene doc.
`parse_jgi_tpm.py` emits ndjson and the stage loads it with `mongoimport --mode=merge`, which
adds the `JGI-SB-*` keys without touching the EBI keys already on the document and avoids
exporting the 4.1 GB `expression` collection.

These scripts are Python (stdlib only) rather than node like `../atlas/`: the sample
descriptions are full of commas so real CSV parsing is required, and it matches the
dependency-free style of `gramene-solr/expression_pipeline/`.

## Changes to `gramene-solr/expression_pipeline/po_map.py`

Three PO ids this study needs were not in `PO_TO_ORGAN`:

    20039 leaf lamina          -> leaf
     9053 peduncle             -> stem
    30123 panicle inflorescence -> inflorescence

plus label fallbacks `("peduncle","stem")`, `("sheath","leaf")`, `("whorl","shoot")` for samples
that arrive without a PO id. Across the 340 distinct `organism part` labels already in the
database, exactly one call changes: "leave without petiole" (PO:0020039) goes from unresolved to
`leaf`, which is a fix.

A bare `("seed","seed")` substring rule was tried and **deliberately rejected** — it swallowed
"seedling aerial portion", "etiolated seedling", "seedling culture", "whole seedlings without
root" and "seed trace". JGI seed samples carry PO:0009010, so the fallback was never needed.

## Hard constraints

- **Accessions must contain no underscore; groups must match `g\d+`.** `mongo2solr.js` writes
  solr fields as `<accession with - replaced by _>_<group>__expr`, and
  `expr_lib.parse_baseline_field()` inverts that by splitting on `_`. `JGI-SB-1` + `g7`
  round-trips; `JGI_SB_1` would not.
- **`55_atlas` drops `experiments`, `assays` and `expression`.** Never run it without re-running
  this stage afterwards.
- **`expression_attributes` goes stale.** Re-run `58_expression_attributes`, then `60_solr_genes`,
  `62_attr_atomic`, `65_solr_suggestions`.

## Known metadata gaps

Blocking-ish, needs the submitter:

1. **No experiment-level metadata.** No title, abstract, publication, DOI or PMID. All 288
   libraries say `publication.status = published` but no citation is given. The
   `description` and `name` currently generated are factual summaries built from the data
   plus the PI name; `description` ends "Submitted via JGI; awaiting citation." **Replace
   these once the citation is known** — `name` elsewhere in Gramene follows
   "Author et al., year - Factor".
2. **No quantification provenance.** No aligner, quantifier, annotation build, library prep,
   strandedness, read layout or mapped-read counts. The filename asserts TPM and v3.1.1;
   nothing else is recorded. GXA experiments carry this in their IDF.

Recorded here, resolved or worked around:

3. **No ontology ids in the source.** Handled by the two curator tables above.
4. **Genotype missing for 118 libraries** (`developmental.stages`, `nitrogen`, part of
   `standard.tissue`). Resolved: all 136 unlabelled-genotype runs are titled
   "Gene expression analysis of Sorghum bicolor **BTx623** - ..." in ENA, checked run by run.
   `DEFAULT_CULTIVAR = "BTx623"` in `build_jgi_experiments.py`.
5. **No umbrella accession.** 288 runs -> 288 distinct `SRP` *and* 288 distinct BioProjects
   (`PRJNA520178` resolves to exactly one run). That is the JGI/GOLD submission style, not a
   mistake — but it means there is no study-level accession to link out to. The per-group
   `sra_runs` / `sra_studies` are kept on `assays[].jgi` so provenance is at least recorded.
6. **Group means only.** No replicate-level values, so no variance and **no differential
   analysis**. `nitrogen` is a real control-vs-treatment design but cannot feed
   `expression_attributes.stress` / `activated_by` / `repressed_by`, which need `p_value < 0.05`.
   All four experiments load as `Baseline`. Ask JGI for per-library TPMs or raw counts if the
   nitrogen stress attributes are wanted.
7. **Ages and growth conditions are prose only.** "60 day", "43 days after anthesis",
   "14 hour daylengths", "~30C/24C", greenhouse vs growth room, "Osmocote 13-13-13" appear
   only inside `sample.description`. The growth condition is parsed out into a characteristic;
   the `T1..T11` / `S1..S11` timepoints have **no numeric DAE/DAA field at all** and are stored
   as opaque labels.
8. **`root_top` / `root_middle` / `root_bottom` names contradict their descriptions**
   (`root_bottom` is described as "middle section 2.5 cm"; `root_middle` and `root_top` both as
   "root tips (distal 1 cm)"). Mapped by description, not by name. All three resolve to the
   `root` organ either way, so the panel is unaffected. Worth querying with the submitter.

## Overlap with the EBI data

Checked: the 288 JGI `SRR` accessions were compared against the run lists in the GXA SDRFs for
all 17 sorghum experiments — **no overlap**, including `E-GEOD-98817` (Kebrom et al. 2017,
Mullet-lab internode development, 13 runs) and `E-MTAB-5956` (166 runs). Six GEO-derived SDRFs
carry no run accessions (`E-GEOD-151860`, `E-GEOD-141035`, `E-GEOD-167101`, `E-CURD-148`,
`E-GEOD-128441`, `E-GEOD-140928`) and remain unchecked; none is internode- or stem-focused.

## Effect on sorghum's organ panel

Sorghum's baseline panel previously rested on 49 assay groups. These 99 groups resolve as:

    root 13   shoot 8   leaf 17   stem 56   inflorescence 3   seed 2

**56 of 99 are stem.** Sorghum had 5 stem samples; it now has 61. Expect `expression_attributes`
to change for most sorghum genes: the level bands are genome-wide quantiles over per-(gene,organ)
median TPM, so adding this much data moves every `level` and `tau` call. That is correct, but it
is a large visible diff, and the `stem` organ is now dominated by one lab's material under one
set of growth conditions. Review rather than accept blindly.

## Files

    tissue_po_map.tsv          curator: 40 tissues -> organism part + PO id
    condition_map.tsv          curator: 39 (experiment, condition) -> typed characteristic
    build_jgi_experiments.py   sheets + curator tables -> experiments/assays ndjson + group LUT
    parse_jgi_tpm.py           TPM matrix + LUTs -> expression ndjson (merge format)
    tmp/                       downloaded sheets and generated artifacts (not in git)

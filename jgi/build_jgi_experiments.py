#!/usr/bin/env python3
"""
build_jgi_experiments.py -- turn the three JGI/Mullet sorghum sheets into mongo docs for the
`experiments` and `assays` collections, plus the group LUT that parse_jgi_tpm.py needs.

Python (stdlib only) rather than node like atlas/: the sample descriptions are full of commas,
so real CSV parsing is required, and this matches the dependency-free style of
gramene-solr/expression_pipeline/.

    ./build_jgi_experiments.py --dir tmp --out tmp
        tmp/samples.csv    tmp/libraries.csv      (CSV exports of the source sheets)
        tissue_po_map.tsv  condition_map.tsv      (curator-editable, alongside this script)
    ->  tmp/experiments.ndjson  tmp/assays.ndjson  tmp/group_lut.json

Accessions are JGI-SB-1..4, assigned by sorting the experiment names; groups are g1..gN,
assigned by sorting the JGI group strings within an experiment. Both are deterministic, so a
re-run produces identical _ids and the load is idempotent under `mongoimport --upsert`.

NB accessions must contain NO underscore and groups must match g\\d+: mongo2solr.js writes solr
fields as `<accession with - replaced by _>_<group>__expr` and expr_lib.parse_baseline_field()
inverts that by splitting on '_', so an underscore would not survive the round-trip.
"""
import argparse, csv, json, os, re, sys
from collections import OrderedDict, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
TAXON = 4558                     # assays/experiments use the base NCBI taxon; genes use *1000
GENOTYPE_PREFIXES = ("TX08001", "Della", "Keller", "DDYM")
# Verified against ENA: all 136 libraries whose group carries no genotype prefix are titled
# "Gene expression analysis of Sorghum bicolor BTx623 - ...".
DEFAULT_CULTIVAR = "BTx623"

GROWTH = {   # prose growth conditions, recovered from sample.description (Gap 7)
    "greenhouse":  "14 hour daylength, ~30C/24C greenhouse, fertilized with Osmocote 13-13-13",
    "growth_room": "14 hour daylength, ~30C/24C growth room, fertilized with Osmocote 13-13-13",
}

# Human-readable experiment names. PI is John Mullet (from the library sheet); no citation is
# recorded in the sheets, so none is invented here -- see Gap 1 in the README.
EXPERIMENT_NAME = {
    "developmental.stages": "Mullet lab - developmental stages",
    "internode.timecourse": "Mullet lab - internode time course",
    "nitrogen":             "Mullet lab - nitrogen source",
    "standard.tissue":      "Mullet lab - standard tissue panel",
}


def read_tsv(path):
    with open(path) as fh:
        lines = [l for l in fh if not l.startswith("#")]
    return list(csv.DictReader(lines, delimiter="\t"))


def po_field(label, po_id):
    """{type,label,ontology,id,int_id} the way getAtlasData.js builds it."""
    out = {"label": label}
    if po_id:
        ont, num = po_id.split(":")
        out.update(ontology=ont, id=po_id, int_id=int(num))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=os.path.join(HERE, "tmp"), help="dir holding the CSV exports")
    ap.add_argument("--out", default=os.path.join(HERE, "tmp"))
    a = ap.parse_args()

    libs = list(csv.DictReader(open(os.path.join(a.dir, "libraries.csv"))))
    samples = {r["sample"]: r for r in csv.DictReader(open(os.path.join(a.dir, "samples.csv")))}
    tissue_map = {r["tissue"]: r for r in read_tsv(os.path.join(HERE, "tissue_po_map.tsv"))}
    cond_map = {(r["experiment"], r["condition"]): r
                for r in read_tsv(os.path.join(HERE, "condition_map.tsv"))}

    # --- fail loudly on an incomplete curator table rather than silently dropping samples ---
    missing_t = sorted({r["tissue"] for r in libs} - set(tissue_map))
    missing_c = sorted({(r["experiment"], r["condition"]) for r in libs} - set(cond_map))
    if missing_t or missing_c:
        sys.exit("curator tables incomplete -- tissues: %s  conditions: %s" % (missing_t, missing_c))
    unmapped = [r["tissue"] for r in tissue_map.values() if not r["organism_part_po"]]
    if unmapped:
        sys.exit("tissue_po_map.tsv has rows with no organism_part_po: %s\n"
                 "Every assay needs an 'organism part' PO term or it contributes to no organ "
                 "(expr_lib.py reads only that field)." % unmapped)

    # --- deterministic accession + group numbering ---
    exp_names = sorted({r["experiment"] for r in libs})
    accession = {name: "JGI-SB-%d" % (i + 1) for i, name in enumerate(exp_names)}
    by_exp = defaultdict(list)
    for r in libs:
        by_exp[r["experiment"]].append(r)
    group_no = {}
    for name in exp_names:
        for i, g in enumerate(sorted({r["group"] for r in by_exp[name]})):
            group_no[(name, g)] = "g%d" % (i + 1)

    experiments, assays, group_lut = [], [], {}

    for name in exp_names:
        acc = accession[name]
        rows = by_exp[name]
        seen_groups = OrderedDict()
        for r in rows:
            seen_groups.setdefault(r["group"], []).append(r)

        # which characteristics actually vary across this experiment's groups -> experiments.factors,
        # and which belong in each assay's `factor` array
        cultivar_varies = len({(r["group"].split(".")[0] if r["group"].split(".")[0] in GENOTYPE_PREFIXES
                                else DEFAULT_CULTIVAR) for r in rows}) > 1
        varies = set(["organism part"])
        if cultivar_varies:
            varies.add("cultivar")

        for g, reps in seen_groups.items():
            r0 = reps[0]
            gid = group_no[(name, r0["group"])]
            aid = "%s.%s" % (acc, gid)
            group_lut[r0["group"]] = {"experiment": acc, "group": gid}

            genotype = r0["group"].split(".")[0]
            cultivar = genotype if genotype in GENOTYPE_PREFIXES else DEFAULT_CULTIVAR
            tm = tissue_map[r0["tissue"]]
            cm = cond_map[(name, r0["condition"])]
            desc = samples.get(r0["group"], {}).get("sample.description", r0["SampleDescription"])
            growth = GROWTH["growth_room"] if "growth room" in desc else (
                     GROWTH["greenhouse"] if "greenhouse" in desc else None)

            chars = [
                dict(type="organism", **po_field("Sorghum bicolor", "NCBITaxon:%d" % TAXON)),
                dict(type="organism part", **po_field(tm["organism_part_label"], tm["organism_part_po"])),
                dict(type="cultivar", label=cultivar),
                # the JGI group string is the join key back to the TPM matrix and the only
                # human-readable sample label -- keep it.
                dict(type="sample id", label=r0["group"]),
            ]
            chars.append(dict(type=cm["characteristic_type"], **po_field(cm["characteristic_label"], cm["po"])))
            if growth:
                chars.append(dict(type="growth condition", label=growth))

            varies.add(cm["characteristic_type"])
            factor_types = {"organism part", cm["characteristic_type"]}
            if cultivar_varies:
                factor_types.add("cultivar")

            assays.append({
                "_id": aid, "experiment": acc, "group": gid, "taxon_id": TAXON,
                "characteristic": chars,
                "factor": [c for c in chars if c["type"] in factor_types],
                # provenance the sheets do carry (Gap 4: no umbrella accession exists)
                "jgi": {"sample": r0["group"], "experiment": name,
                        "n_replicates": len(reps),
                        "libraries": sorted(x["library"] for x in reps),
                        "sra_runs": sorted(x["SRA_run"] for x in reps),
                        "sra_studies": sorted({x["SRA_study"] for x in reps}),
                        "description": desc},
            })

        order = ["organism part", "developmental stage", "growth condition",
                 "sampling time point", "sampling site", "cultivar"]
        experiments.append({
            "_id": acc, "taxon_id": TAXON, "source": "JGI", "type": "Baseline",
            "name": EXPERIMENT_NAME.get(name, "Mullet lab - " + name),
            "factors": [f for f in order if f in varies],
            "description": ("Sorghum bicolor %s: %d sample groups from %d RNA-seq libraries "
                            "(Phytozome Sbicolor v3.1.1). PI John Mullet, Texas A&M. "
                            "Submitted via JGI; awaiting citation." %
                            (name.replace(".", " "), len(seen_groups), len(rows))),
            "jgi": {"experiment": name, "pi": "John Mullet", "annotation": "Sbicolor.v3.1.1"},
        })

    os.makedirs(a.out, exist_ok=True)
    for fname, docs in (("experiments.ndjson", experiments), ("assays.ndjson", assays)):
        with open(os.path.join(a.out, fname), "w") as fh:
            for d in docs:
                fh.write(json.dumps(d) + "\n")
    json.dump(group_lut, open(os.path.join(a.out, "group_lut.json"), "w"), indent=1, sort_keys=True)

    print("experiments: %d  assays: %d  groups in lut: %d" % (len(experiments), len(assays), len(group_lut)))
    for e in experiments:
        print("  %-10s %-24s %3d groups  factors=%s"
              % (e["_id"], e["jgi"]["experiment"],
                 sum(1 for x in assays if x["experiment"] == e["_id"]), e["factors"]))


if __name__ == "__main__":
    main()

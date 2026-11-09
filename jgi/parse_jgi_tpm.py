#!/usr/bin/env python3
"""
parse_jgi_tpm.py -- turn the JGI group-mean TPM matrix into ndjson for the `expression`
collection, keyed by Gramene gene id.

    ./parse_jgi_tpm.py --dir tmp --out tmp/expression_jgi.ndjson
        tmp/tpm.csv           GeneID (Sobic.*) x 99 group columns, one mean TPM per cell
        tmp/group_lut.json    JGI group string -> {experiment: "JGI-SB-n", group: "gN"}
        tmp/sobic2sorbi.tsv   Sobic.* <TAB> SORBI_3* (built from genes.alt_id by the stage)
    ->  {"_id":"SORBI_3001G000100","JGI-SB-1":[{"group":"g7","value":0.441}, ...]}

The output is MERGED into existing gene documents with `mongoimport --mode=merge`, which adds
the JGI-SB-* keys without touching the EBI keys already on the doc. (atlas/parseData.js cannot
be reused: it starts at column index 2 because GXA TSVs carry a Gene Name column, and it does
`split(',')[2]` because GXA cells hold five comma-separated quartiles -- a plain "0.441" would
yield NaN.)

Zeros are kept. They are real measurements, and everything downstream applies its own cutoff
(mongo2solr and expressed_in_gxa_atomic.js need value >= 0.5; expr_lib's detection floor is 1.0
TPM), so dropping them would bias the per-organ medians instead of saving meaningful space.
"""
import argparse, csv, json, os, sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=os.path.join(HERE, "tmp"))
    ap.add_argument("--out", default=os.path.join(HERE, "tmp", "expression_jgi.ndjson"))
    ap.add_argument("--unmapped", default=os.path.join(HERE, "tmp", "unmapped_genes.txt"))
    a = ap.parse_args()

    group_lut = json.load(open(os.path.join(a.dir, "group_lut.json")))
    sobic2sorbi = dict(l.rstrip("\n").split("\t")
                       for l in open(os.path.join(a.dir, "sobic2sorbi.tsv")) if l.strip())
    if not sobic2sorbi:
        sys.exit("sobic2sorbi.tsv is empty -- build it from genes.alt_id first")

    fh = open(os.path.join(a.dir, "tpm.csv"), newline="")
    rdr = csv.reader(fh)
    header = next(rdr)
    if header[0] != "GeneID":
        sys.exit("unexpected first column %r (expected GeneID)" % header[0])
    cols = header[1:]

    missing_cols = [c for c in cols if c not in group_lut]
    if missing_cols:
        sys.exit("TPM columns absent from group_lut.json: %s" % missing_cols[:10])
    missing_groups = sorted(set(group_lut) - set(cols))
    if missing_groups:
        sys.exit("groups in the metadata with no TPM column: %s" % missing_groups[:10])

    # column index -> (accession, gN), resolved once
    targets = [(group_lut[c]["experiment"], group_lut[c]["group"]) for c in cols]

    n_genes = n_out = 0
    unmapped, per_exp = [], Counter()
    with open(a.out, "w") as out:
        for row in rdr:
            n_genes += 1
            gene = sobic2sorbi.get(row[0])
            if gene is None:
                unmapped.append(row[0])
                continue
            doc = {"_id": gene}
            byexp = defaultdict(list)
            for i, cell in enumerate(row[1:]):
                cell = cell.strip()
                if cell == "":
                    continue                      # no measurement, not a zero
                acc, grp = targets[i]
                byexp[acc].append({"group": grp, "value": float(cell)})
            for acc, samples in byexp.items():
                doc[acc] = samples
                per_exp[acc] += 1
            out.write(json.dumps(doc) + "\n")
            n_out += 1
    fh.close()

    with open(a.unmapped, "w") as u:
        for g in unmapped:
            u.write(g + "\n")

    print("matrix genes: %d   mapped: %d   unmapped: %d -> %s"
          % (n_genes, n_out, len(unmapped), a.unmapped))
    for acc in sorted(per_exp):
        print("  %-10s %d gene docs" % (acc, per_exp[acc]))
    if unmapped:
        print("  unmapped (no Sobic.* alt_id in Gramene): %s%s"
              % (", ".join(unmapped[:6]), " ..." if len(unmapped) > 6 else ""))


if __name__ == "__main__":
    main()

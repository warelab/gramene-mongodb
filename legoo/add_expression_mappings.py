#!/usr/bin/env python3
"""add_expression_mappings.py -- add LeGOO's curated Mt4.0 -> Mt5.0 pairs to the expression LUT.

Expression Atlas keys medicago expression on Mt4.0 ids (MTR_1g004990) while this release's
medicago is MtrunA17r5.0_ANR, so ../atlas/new_old.lut.txt exists to make that data joinable at all.
It currently carries 23,073 medicago pairs derived from protein identity and NCBI GeneIDs
(see ../atlas/build_medicago_expression_lut.sh). LeGOO supplies a third, independent, hand-curated
set, which both cross-validates those and fills gaps they missed.

CONFLICT POLICY: ours wins. Of the genes present in both, 99.3% agree -- two independent methods
corroborating each other. For the handful that disagree, curation is not automatically right: for
MtrunA17_Chr3g0119041 LeGOO gives MTR_5g079850 while our MTR_3g079850 is chromosome-consistent,
which looks like a digit error upstream. So a conflicting LeGOO pair is reported and skipped, never
merged. Only genes ABSENT from the LUT are added.

The LUT line format is "<new_id>\t<old_id>", which is what project_expression_via_lut.js reads.

Read-only except for ../atlas/new_old.lut.txt, which is backed up before being rewritten.
usage: add_expression_mappings.py [--dry-run]
"""
import io
import os
import shutil
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
LUT = os.path.join(HERE, '..', 'atlas', 'new_old.lut.txt')
TSV = os.path.join(HERE, 'legoo_genes.tsv')
PREFIX = 'MtrunA17'


def main():
    dry = '--dry-run' in sys.argv

    if not os.path.exists(TSV):
        sys.exit('%s missing -- run parse_legoo.py first' % TSV)

    # existing LUT, order preserved so the rewrite is an append and diffs stay readable
    lines = io.open(LUT, encoding='utf-8').read().splitlines()
    mine = {}
    for ln in lines:
        f = ln.split('\t')
        if len(f) == 2 and f[0].startswith(PREFIX):
            mine.setdefault(f[0], set()).add(f[1])
    old_owner = {}
    for ln in lines:
        f = ln.split('\t')
        if len(f) == 2:
            old_owner.setdefault(f[1], set()).add(f[0])
    print('LUT lines:                     %d' % len(lines))
    print('  medicago genes mapped:       %d' % len(mine))

    legoo = {}
    for i, ln in enumerate(io.open(TSV, encoding='utf-8')):
        if i == 0 or not ln.strip():
            continue
        f = ln.rstrip('\n').split('\t')
        if len(f) < 6 or not f[5]:
            continue
        legoo[f[0]] = set(x for x in f[5].split(',') if x)
    print('LeGOO genes with an Mt4.0 id:  %d' % len(legoo))

    both = set(legoo) & set(mine)
    agree = [g for g in both if legoo[g] & mine[g]]
    conflict = sorted(g for g in both if not (legoo[g] & mine[g]))
    extra = sorted(g for g in agree if legoo[g] - mine[g])
    newgenes = sorted(set(legoo) - set(mine))

    print()
    print('in both:                       %d' % len(both))
    print('  agree:                       %d  (%.1f%%)'
          % (len(agree), 100.0 * len(agree) / len(both) if both else 0))
    print('  conflict (ours kept):        %d' % len(conflict))
    print('  agree but LeGOO adds an id:  %d  (not added; ours is sufficient)' % len(extra))
    print('absent from LUT -> TO ADD:     %d' % len(newgenes))

    if conflict:
        print()
        print('conflicts, ours kept:')
        for g in conflict:
            print('  %-26s ours=%-14s LeGOO=%s'
                  % (g, ','.join(sorted(mine[g])), ','.join(sorted(legoo[g]))))

    # An Mt4.0 id that already projects onto a different gene would make one Atlas record attach to
    # two genes. Legitimate for a split gene model, but it is not what this loader is for, so skip.
    additions, steal = [], []
    for g in newgenes:
        for old in sorted(legoo[g]):
            owners = old_owner.get(old, set())
            if owners - {g}:
                steal.append((g, old, sorted(owners)))
                continue
            additions.append((g, old))
    if steal:
        print()
        print('skipped -- the Mt4.0 id is already projected onto another gene:')
        for g, old, owners in steal:
            print('  %-26s %-14s already -> %s' % (g, old, ','.join(owners)))

    print()
    print('new LUT lines to write:        %d  (for %d genes)'
          % (len(additions), len(set(g for g, _ in additions))))
    if dry:
        print('--dry-run: nothing written')
        return
    if not additions:
        print('nothing to add')
        return

    bak = LUT + '.bak.' + time.strftime('%Y%m%d%H%M%S')
    shutil.copy2(LUT, bak)
    print('backed up -> %s' % bak)
    with io.open(LUT, 'a', encoding='utf-8') as fh:
        for g, old in additions:
            fh.write(u'%s\t%s\n' % (g, old))
    after = len(io.open(LUT, encoding='utf-8').read().splitlines())
    print('LUT lines: %d -> %d' % (len(lines), after))
    if after != len(lines) + len(additions):
        sys.exit('line count did not move by the expected amount -- inspect %s' % LUT)
    print('ok')


if __name__ == '__main__':
    main()

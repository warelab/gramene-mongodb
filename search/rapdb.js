#!/usr/bin/env node

// RAP-DB's curated gene list for Oryza sativa japonica -- symbols, full names, PO/TO terms and
// structured PubMed references, keyed on the RAP locus ids (Os01g0100100) that are already this
// build's rice gene stable ids, so no id mapping is needed.
//
// URL history: the code used to carry rapdb.dna.affrc.go.jp, which is DEAD (the host does not
// answer at all), overwritten on the next line by a mirror on dev.gramene.org that we do not
// control and that lags upstream. Upstream naro.go.jp is primary now, with the mirror kept as an
// explicit fallback.
//
// All behaviour lives in curated_source.js, shared with curated.js.

module.exports = function () {
  return require('./curated_source')({
    label: 'rapdb',
    source: 'rap-db',
    urls: ['https://dev.gramene.org/oryza/rapdb/curated_genes.json'],
    refTextField: 'title'
  });
};

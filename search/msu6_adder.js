#!/usr/bin/env node
var through2 = require('through2');
var _ = require('lodash');
// OsNipp_IRGSP_MSU_lut.json maps each rice gene _id (RAP-DB Os##g####### / organellar
// gene-*) to its MSU6/RGAP locus id, as { MSU_id: "LOC_Os..." }. We add that LOC_Os id
// as an ALTERNATE ID (gene.alt_id), so it is searchable and gets an "Alternate IDs"
// suggestion that resolves to the primary rice gene (like Sobic./GRMZM/Vitvi for the
// other species). Optional: if the LUT isn't present this adder degrades to a
// passthrough rather than crashing the whole decorate pipeline at load time.
var lut = {};
try {
  lut = require('./OsNipp_IRGSP_MSU_lut.json');
} catch (e) {
  console.error('msu6_adder: OsNipp_IRGSP_MSU_lut.json not found — skipping MSU6 rice alt ids');
}

module.exports = function() {
  console.error("msu6_adder lut with ",Object.keys(lut).length," genes");
  return through2.obj(function (gene, enc, done) {
    var that = this;

    if(!_.isObject(gene)) {
      throw new Error('gene is lacking needed info');
    }
    var hit = lut[gene._id];
    if (hit && hit.MSU_id) {
      if (!gene.hasOwnProperty('alt_id')) gene.alt_id = [];
      gene.alt_id.push(hit.MSU_id);
      gene.alt_id = _.uniq(gene.alt_id);
    }
    that.push(gene);
    done();
  });

}

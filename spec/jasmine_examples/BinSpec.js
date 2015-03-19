describe('Bins', function () {
  // json response to http://data.gramene.org/maps/select?type=genome
  // converted into a commonJS module by prepending json doc with
  // `module.exports = `
  var genomes = require('../support/genomes.js');
  var binsGenerator = require('../../maps/bins');
  var bins;
  var mapper_2Mb;
  var mapper_200;

  // example data for mapper_2Mb
  var chocolate_taxon_id = 3641;
  var chocolate_region = "1";
  var chocolate_start = 1;
  var chocolate_end = 2000000;
  var chocolate_bin = 2;
  var chocolate_unanchored_bin = 207;

  var chocolate_genome_length = 330456197;
  var chocolate_end_fixed200 = Math.floor(chocolate_genome_length / 200);

  var arabidopsis_thaliana_taxon_id = 3702;


  beforeEach(function () {
    bins = binsGenerator(genomes.response);
    mapper_2Mb = bins.binMapper('uniform', 2000000);
    mapper_200 = bins.binMapper('fixed', 200);
  });

  it('pos2bin should work with uniform', function () {
    // when
    var bin = mapper_2Mb.pos2bin(chocolate_taxon_id, chocolate_region, chocolate_start);

    // then
    expect(bin).toEqual(chocolate_bin);
  });

  it('bin2pos should work with uniform', function () {
    // when
    var result = mapper_2Mb.bin2pos(chocolate_bin);

    // then
    expect(Object.keys(result).length).toEqual(4);
    expect(Object.keys(result)).toEqual(['taxon_id', 'region', 'start', 'end']);
    expect(result.taxon_id).toEqual(chocolate_taxon_id);
    expect(result.region).toEqual(chocolate_region);
    expect(result.start).toEqual(chocolate_start);
    expect(result.end).toEqual(chocolate_end);
  });

  it('pos2bin should work with fixed', function () {
    // when
    var bin = mapper_200.pos2bin(chocolate_taxon_id, chocolate_region, chocolate_start);

    // then
    expect(bin).toEqual(chocolate_bin);
  });

  it('bin2pos should work with fixed', function () {
    // when
    var result = mapper_200.bin2pos(chocolate_bin);

    // then
    expect(Object.keys(result).length).toEqual(4);
    expect(Object.keys(result)).toEqual(['taxon_id', 'region', 'start', 'end']);
    expect(result.taxon_id).toEqual(chocolate_taxon_id);
    expect(result.region).toEqual(chocolate_region);
    expect(result.start).toEqual(chocolate_start);
    expect(result.end).toEqual(chocolate_end_fixed200);
  });

  it('bin2pos should throw with illegal parameters', function() {
    // when
    var bin2posFixed = function(){ mapper_200.bin2pos(1e9) };
    var bin2posUniform = function(){ mapper_2Mb.bin2pos(1e9) };

    // then
    expect(bin2posFixed).toThrow();
    expect(bin2posUniform).toThrow();
  });

  it('pos2bin should throw with illegal taxon_id', function() {
    // when
    var illegalTaxonId = function() {mapper_200.pos2bin(1, -1, -1)};

    // then
    expect(illegalTaxonId).toThrow();
  });

  it('pos2bin should assume you are asking for an UNANCHORED region if ' +
  'the region is not recognized and the genome has an UNANCHORED region', function() {
    // when
    var illegalRegion1 = mapper_200.pos2bin(chocolate_taxon_id, "100", -1);

    // then
    expect(illegalRegion1).toEqual(chocolate_unanchored_bin);
  });

  it('pos2bin should throw when an unrecognized region is requested from a ' +
  'genome without UNANCHORED sequence', function() {
    // when
    var illegalRegion1 = function(){mapper_200.pos2bin(arabidopsis_thaliana_taxon_id, "100", -1)};

    // then
    expect(illegalRegion1).toThrow();
  });

  it('pos2bin should throw when an illegal position is requested', function() {
    // when
    var illegalRegion1 = function(){mapper_200.pos2bin(arabidopsis_thaliana_taxon_id, "1", -1)};
    var illegalRegion2 = function(){mapper_200.pos2bin(arabidopsis_thaliana_taxon_id, "1", 1e11)};

    // then
    expect(illegalRegion1).toThrow();
    expect(illegalRegion2).toThrow();
  });
});
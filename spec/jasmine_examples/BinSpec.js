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
    var startBin = mapper_2Mb.pos2bin(chocolate_taxon_id, chocolate_region, chocolate_start);
    var endBin = mapper_2Mb.pos2bin(chocolate_taxon_id, chocolate_region, chocolate_end);

    // then
    expect(startBin).toEqual(chocolate_bin);
    expect(endBin).toEqual(chocolate_bin);
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
    var startBin = mapper_200.pos2bin(chocolate_taxon_id, chocolate_region, chocolate_start);
    var endBin = mapper_200.pos2bin(chocolate_taxon_id, chocolate_region, chocolate_end_fixed200);

    // then
    expect(startBin).toEqual(chocolate_bin);
    expect(endBin).toEqual(chocolate_bin);
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

  it('bin2pos should throw with illegal parameters', function () {
    // when
    var bin2posFixed = function () { mapper_200.bin2pos(1e9) };
    var bin2posUniform = function () { mapper_2Mb.bin2pos(1e9) };

    // then
    expect(bin2posFixed).toThrow();
    expect(bin2posUniform).toThrow();
  });

  it('pos2bin should throw with illegal taxon_id', function () {
    // when
    var illegalTaxonId = function () {mapper_200.pos2bin(1, -1, -1)};

    // then
    expect(illegalTaxonId).toThrow();
  });

  it('pos2bin should assume you are asking for an UNANCHORED region if ' +
  'the region is not recognized and the genome has an UNANCHORED region', function () {
    // when
    var illegalRegion1 = mapper_200.pos2bin(chocolate_taxon_id, "100", -1);

    // then
    expect(illegalRegion1).toEqual(chocolate_unanchored_bin);
  });

  it('pos2bin should throw when an unrecognized region is requested from a ' +
  'genome without UNANCHORED sequence', function () {
    // when
    var illegalRegion1 = function () {mapper_200.pos2bin(arabidopsis_thaliana_taxon_id, "100", -1)};

    // then
    expect(illegalRegion1).toThrow();
  });

  it('pos2bin should throw when an illegal position is requested', function () {
    // when
    var illegalRegion1 = function () {mapper_200.pos2bin(arabidopsis_thaliana_taxon_id, "1", -1)};
    var illegalRegion2 = function () {mapper_200.pos2bin(arabidopsis_thaliana_taxon_id, "1", 1e11)};

    // then
    expect(illegalRegion1).toThrow();
    expect(illegalRegion2).toThrow();
  });

  it('should support custom mapping', function () {
    // given
    var myBins = [
      {taxon_id: 3702, region: "1", start: 123, end: 432},
      {taxon_id: 3702, region: "1", start: 555, end: 888},
      {taxon_id: 3702, region: "2", start: 111, end: 444}
    ];
    var customMapper = bins.binMapper('variable', myBins);

    // when
    var bin1start = customMapper.pos2bin(3702, "1", 123);
    var bin1start2 = customMapper.pos2bin(3702, 1, 123);
    var bin1end = customMapper.pos2bin(3702, "1", 432);
    var bin1end2 = customMapper.pos2bin(3702, "1", "432");
    var bin1end3 = customMapper.pos2bin("3702", "1", "432");

    // then
    expect(bin1start).toEqual(0);
    expect(bin1start2).toEqual(0);
    expect(bin1end).toEqual(0);
    expect(bin1end2).toEqual(0);
    expect(bin1end3).toEqual(0);
  });

  it('should return -1 with illegal bin postions', function() {
    // given
    var myBins = [
      {taxon_id: 3702, region: "1", start: 123, end: 432},
      {taxon_id: 3702, region: "1", start: 555, end: 888},
      {taxon_id: 3702, region: "2", start: 111, end: 444}
    ];
    var customMapper = bins.binMapper('variable', myBins);

    // when
    var nobin1 = customMapper.pos2bin(3702, "1", 433);
    var nobin2 = customMapper.pos2bin(3702, "1", 0);
    var nobin3 = customMapper.pos2bin(3702, "1", new Date());
    var nobin4 = customMapper.pos2bin(3702, "1", Array.prototype.slice);
    var nobin5 = customMapper.pos2bin(3702, Array.prototype.slice, 123);
    var nobin6 = customMapper.pos2bin(Array.prototype.slice, "1", 123);

    // then
    expect(nobin1).toEqual(-1);
    expect(nobin2).toEqual(-1);
    expect(nobin3).toEqual(-1);
    expect(nobin4).toEqual(-1);
    expect(nobin5).toEqual(-1);
    expect(nobin6).toEqual(-1);
  });

  it('should return the variable bin by index', function() {
    // given
    var myBins = [
      {taxon_id: 3702, region: "1", start: 123, end: 432},
      {taxon_id: 3702, region: "1", start: 555, end: 888},
      {taxon_id: 3702, region: "2", start: 111, end: 444}
    ];
    var customMapper = bins.binMapper('variable', myBins);
    var idx = 0;

    // when
    var bin = customMapper.bin2pos(idx);

    // then
    expect(bin).toEqual(myBins[idx]);
  });

  it('should error out when asking for unreasonable bins', function() {
    // given
    var myBins = [
      {taxon_id: 3702, region: "1", start: 123, end: 432},
      {taxon_id: 3702, region: "1", start: 555, end: 888},
      {taxon_id: 3702, region: "2", start: 111, end: 444}
    ];
    var customMapper = bins.binMapper('variable', myBins);
    var illegalIdx = 5;

    // when
    var bin = function(){customMapper.bin2pos(illegalIdx);};

    // then
    expect(bin).toThrow();
  });

  it('should disallow overlapping custom bins', function() {
    // given
    var myBins = [
      {taxon_id: 3702, region: "1", start: 1, end: 432},
      {taxon_id: 3702, region: "1", start: 3, end: 888},
      {taxon_id: 3702, region: "2", start: 2, end: 444}
    ];

    var shouldFail = function() {bins.binMapper('variable', myBins);};

    expect(shouldFail).toThrow();
  });
});
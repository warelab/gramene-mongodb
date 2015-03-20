/*
  bins - a module for bins defined on an ordered set of maps
         such as the genomes in Gramene.

  Bin numbers are global so they can uniquely identify an interval
  on a chromosome (aka. region). This is why the maps and regions need to be ordered.

  Once the maps have been loaded, you can get a binMapper for a set of bins.

  The bins can be defined as follows:
      a bin size for uniform-width bins in nucleotides
      an arbitrary set of intervals {taxon_id: , region: , start: , end: }

  bins = require('bins.js')(map_info);
  mapper_2Mb = bins.binMapper('uniform',2000000);
  bin = mapper_2Mb.pos2bin(taxon_id, region, position); // returns -1 for positions not in a bin
  interval = mapper_2Mb.bin2pos(bin); // returns an interval that contains position
*/

var isNumber = require('is-number');

module.exports = function(data) {
  var maps = [];
  var map_idx = {};
  for(var i=0;i<data.length;i++) {
    var d = data[i];
    map_idx[d.taxon_id] = i;
    var map = {};
    map.taxon_id = d.taxon_id;
    map.length = d.length; // does not include UNANCHORED region
    map.regions = d.regions.names;
    map.lengths = d.regions.lengths;
    map.region_idx = {}; // needed for sorting user provided bins
    for(var j=0;j<map.regions.length;j++) {
      map.region_idx[map.regions[j]] = j;
    }
    maps.push(map);
  }
  
  function uniformBins(binSize) {
    var binPos = [];
    var posBin = {};
    var bin_idx = 0;
    for (var m in maps) {
      var map = maps[m];
      var tax = map.taxon_id;
      posBin[tax] = {};
      var nRegions = map.regions.length;
      for (var i=0;i<nRegions;i++) {
        var rlen = map.lengths[i];
        var rname = map.regions[i];
        posBin[tax][rname] = [rlen, binPos.length];
        var nbins = (rname === 'UNANCHORED') ? 1 : Math.ceil(rlen/binSize);
        for(var j=0; j < nbins; j++) {
          var end = (j+1 === nbins) ? rlen : (j+1)*binSize;
          binPos.push({taxon_id:tax,region:rname,start:j*binSize+1,end:end});
        }
      }
    }
    return {
      // _binPos: binPos, // uncomment if you want to bipass sanity checks in bin2pos()
      // _posBin: posBin,
      bin2pos: function(bin) {
        if (bin < 0 || bin >= binPos.length) {
          throw 'bin ' + bin + ' out of range';
        }
        return binPos[bin];
      },
      pos2bin: function(tax, region, position) {
        if (!posBin.hasOwnProperty(tax)) {
          throw tax + ' not a known taxonomy id';
        }
        if (region === 'UNANCHORED' || !posBin[tax].hasOwnProperty(region)) {
          // assume UNANCHORED
          if (!posBin[tax].hasOwnProperty('UNANCHORED')) {
            throw region + ' not a known seq region';
          }
          return posBin[tax]['UNANCHORED'][1];
        }
        if (position < 1 || position >= posBin[tax][region][0]) {
          throw 'position ' + position + ' out of range';
        }
        return posBin[tax][region][1] + Math.floor((position-1)/binSize);
      },
      nbins: binPos.length
    };
  }

  function fixedBins(nBins) {
    var binPos = [];
    var posBin = {};
    var bin_idx = 0;
    for (var m in maps) {
      var map = maps[m];
      var tax = map.taxon_id;
      posBin[tax] = {};
      var nRegions = map.regions.length;
      var binSize = Math.floor(map.length/nBins);
      for (var i=0;i<nRegions;i++) {
        var rlen = map.lengths[i];
        var rname = map.regions[i];
        posBin[tax][rname] = [rlen, binPos.length];
        var nbins = (rname === 'UNANCHORED') ? 1 : Math.ceil(rlen/binSize);
        for(var j=0; j < nbins; j++) {
          var end = (j+1 === nbins) ? rlen : (j+1)*binSize;
          binPos.push({taxon_id:tax,region:rname,start:j*binSize+1,end:end});
        }
      }
    }
    return {
      // _binPos: binPos, // uncomment if you want to bipass sanity checks in bin2pos()
      // _posBin: posBin,
      bin2pos: function(bin) {
        if (bin < 0 || bin >= binPos.length) {
          throw 'bin ' + bin + ' out of range';
        }
        return binPos[bin];
      },
      pos2bin: function(tax, region, position) {
        if (!posBin.hasOwnProperty(tax)) {
          throw tax + ' not a known taxonomy id';
        }
        if (region === 'UNANCHORED' || !posBin[tax].hasOwnProperty(region)) {
          // assume UNANCHORED
          if (!posBin[tax].hasOwnProperty('UNANCHORED')) {
            throw region + ' not a known seq region';
          }
          return posBin[tax]['UNANCHORED'][1];
        }
        if (position < 1 || position > posBin[tax][region][0]) {
          throw 'position ' + position + ' out of range';
        }
        var binSize = Math.floor(maps[map_idx[tax]].length/nBins);
        return posBin[tax][region][1] + Math.floor((position-1)/binSize);
      },
      nbins: binPos.length
    };
  }

  function variableBins(bins) {
    // sort the bins to match the order given in the maps
    bins.sort(function(a,b) {
      var a_idx = map_idx[a.taxon_id];
      var b_idx = map_idx[b.taxon_id];
      if (a_idx > b_idx) {
        return 1;
      }
      if (a_idx < b_idx) {
        return -1;
      }
      // same species, check index of region
      var ar_idx = maps[a_idx].region_idx[a.region];
      var br_idx = maps[b_idx].region_idx[b.region];
      if (ar_idx > br_idx) {
        return 1;
      }
      if (ar_idx < br_idx) {
        return -1;
      }
      // same region,  check for overlap and compare bin start positions

      if (a.start > b.start) {
        if(a.start <= b.end) {
          throw new Error('overlapping bins found: ' + JSON.stringify(a) + ' and ' + JSON.stringify(b));
        }
        return 1;
      }
      if (a.start < b.start) {
        if(a.end >= b.start) {
          throw new Error('overlapping bins found: ' + JSON.stringify(a) + ' and ' + JSON.stringify(b));
        }
        return -1;
      }
      throw new Error('found two apparently identical bins: ' + JSON.stringify(a) + ' and ' + JSON.stringify(b));
    });
    var binPos = bins;
    var posBin = {};
    for(var i=0;i<binPos.length;i++) {
      var bin = binPos[i];
      if (! posBin.hasOwnProperty(bin.taxon_id)) {
        posBin[bin.taxon_id] = {};
      }
      if (! posBin[bin.taxon_id].hasOwnProperty(bin.region)) {
        posBin[bin.taxon_id][bin.region] = {o:i,bins:[]};
      }
      posBin[bin.taxon_id][bin.region].bins.push(bin.start,bin.end);
    }

    return {
      bin2pos: function(bin) {
        if (bin < 0 || bin >= binPos.length) {
          throw 'bin ' + bin + ' out of range';
        }
        return binPos[bin];
      },
      pos2bin: function(tax, region, position) {
        if (!(posBin.hasOwnProperty(tax) && posBin[tax].hasOwnProperty(region))) {
          return -1; // no bins here
        }
        var rbins = posBin[tax][region].bins;
        // binary search in rbins for position
        var a = 0;
        var b = rbins.length-1;
        if (position < rbins[a] || position > rbins[b] || !isNumber(position)) { // possibly invalid position that doesn't fall into any bins
          return -1;
        }
        while (a<b) {
          // assume uniform bin distribution and guess a bin
          var f = Math.floor((b - a)*(position - rbins[a])/(rbins[b] - rbins[a]));
          if (f<0) return -1;
          if (f>a && f%2==1) f--;
          if (position < rbins[f]) {
            b = f-1;
          }
          else if (position > rbins[f+1]) {
            a = f+2;
          }
          else {
            return posBin[tax][region].o + f/2;
          }
        }
        return -1;
      },
      nbins: binPos.length
    };
  }

  return {
    binMapper: function(binType,arg) {
      if (binType === 'uniform') {
        return uniformBins(arg);
      }
      if (binType === 'fixed') {
        return fixedBins(arg);
      }
      if (binType === 'variable') {
        // assume we've been given array of valid non-overlapping intervals as objects with keys
        // taxon_id, region, start, end
        // arg checking might be a good idea
        return variableBins(arg);
      }
      return 'error, '+binType+' is not a valid binType';
    }
  };
}
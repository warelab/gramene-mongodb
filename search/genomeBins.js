/*
The input data looks like this:
{
  sizes : [1,2,5,10],
  lut :
  {
    "$taxon_id" :
    {
      "$region" :
      {
        "l" : $length,
        "b" : [$bin1, $bin2, $bin5, $bin10]
      }
    }
  }
}
*/
module.exports = function(data) {
  var binPos = {};
  var posBin = {};
  for(var i=0; i<data.sizes.length; i++) {
    var binSize = data.sizes[i]*1000000;
    var mb = data.sizes[i];
    binPos[mb] = [];
    posBin[mb] = {};
    for (var tax in data.lut) {
      posBin[mb][tax] = {};
      for (var region in data.lut[tax]) {
        var rlen = data.lut[tax][region].l;
        var bins = data.lut[tax][region].b;
        posBin[mb][tax][region] = [rlen, bins[i]];
        var nbins = (region === 'UNANCHORED') ? 1 : Math.ceil(rlen/binSize);
        for(var j=0; j < nbins; j++) {
          var end = (j+1 === nbins) ? rlen : (j+1)*binSize;
          binPos[mb].push({taxon:tax,region:region,start:j*binSize,end:end});
        }
      }
    }
  }
  var API = {
    binToGenome: function(mb, bin) {
      if (!binPos.hasOwnProperty(mb)) {
        throw mb + ' not a known bin size';
      }
      if (bin < 0 || bin >= binPos[mb].length) {
        throw 'bin ' + bin + ' out of range';
      }
      return binPos[mb][bin];
    },
    b2g: function(mb, bin) {
      return binPos[mb][bin];
    },
    genomeToBin: function(mb, tax, region, position) {
      if (!posBin.hasOwnProperty(mb)) {
        throw mb + ' not a known bin size';
      }
      if (!posBin[mb].hasOwnProperty(tax)) {
        throw tax + ' not a known taxonomy id';
      }
      if (region === 'UNANCHORED' || !posBin[mb][tax].hasOwnProperty(region)) {
        // assume UNANCHORED
        if (!posBin[mb][tax].hasOwnProperty('UNANCHORED')) {
          throw region + ' not a known seq region';
        }
        return posBin[mb][tax]['UNANCHORED'][1];
      }
      if (position < 0 || position >= posBin[mb][tax][region][0]) {
        throw 'position ' + position + ' out of range';
      }
      var binSize = 1000000*mb;
      return posBin[mb][tax][region][1] + Math.floor(position/binSize);
    },
    g2b:  function(mb, tax, region, position) {
      var binSize = 1000000*mb;
      return posBin[mb][tax][region][1] + Math.floor(position/binSize);
    },
    nbins: function(mb) {
      return binPos[mb].length;
    }
  };
  return API;
}
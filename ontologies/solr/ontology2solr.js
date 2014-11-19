var fs = require('fs');
var filename = process.argv[2];

function add_xrefs(dest, src) {
  for(var db in src) {
    if (typeof(src[db][0]) === 'number') {
      dest[db + '_xrefi'] = src[db];
    }
    else {
      dest[db + '_xrefs'] = src[db];
    }
  }
}

function add_ancestors(dest, src) {
  for(var db in src) {
    dest[db + '_ancestors'] = src[db];
  }
}

// setup reader
var n=0;
require('readline').createInterface(
  {
    input: fs.createReadStream(filename),
    terminal: false
  }
).on('line', function(line) { // one JSON object per line
  var mongo = JSON.parse(line);
  var solr = {};
  solr.id = mongo._id;
  for (var k in mongo) {
    if (k === "_id") solr.id = mongo._id;
    else {
      if      (typeof(mongo[k]) === 'number') solr[k+'_i'] = mongo[k];
      else if (typeof(mongo[k]) === 'string') solr[k+'_s'] = mongo[k];
      else if (typeof(mongo[k]) === 'object') {
        var numbers=0;
        for(var i=0;i<mongo[k].length;i++) {
          if (typeof(mongo[k][i]) === 'number') numbers++;
        }
        if (numbers === 0) solr[k+'_ss'] = mongo[k];
        else if (numbers === mongo[k].length) solr[k+'_is'] = mongo[k];
      }
    }
  }

  if (n===0) console.log('[');
  else console.log(',');
  console.log(JSON.stringify(solr));
  n++;
}).on('close', function() {
  console.log(']');
});

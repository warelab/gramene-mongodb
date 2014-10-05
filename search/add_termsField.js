/*
the _terms field is used to implement type-ahead search
see the suggest function in app.js

given an input stream of documents and a list of fields
this script will identify terms in those fields
and put them into a _terms field (an array)
*/
var skip = {};
var fs = require('fs');
var filename = process.argv[2];
var fields = process.argv.slice(3);


// retrieve a subObject based on a list of keys
function getField(o,keys) {
    var subObj = o;
    for(var i in keys) {
        if (subObj.hasOwnProperty(keys[i])) {
            subObj = subObj[keys[i]];
        }
        else {
            return undefined;
        }
    }
    if (typeof subObj === "string") return [subObj];
    return subObj;
}

// setup reader
require('readline').createInterface(
  {
    input: fs.createReadStream(filename),
    terminal: false
  }
).on('line', function(line) { // one JSON object per line
  var obj = JSON.parse(line);
  var docTerms = {};
  for (var i=0;i<fields.length;i++) {
    var terms = getField(obj, fields[i].split(':'));
    if (terms) {
      for (var j=0;j<terms.length;j++) {
        terms[j].split(/[^\w\d_-]+/).forEach(function(word) {
          var lcword = word.toLowerCase();
          if (!skip.hasOwnProperty(lcword)) {
            if (lcword.match(/[a-z]/)) {
              if (docTerms.hasOwnProperty(lcword)) docTerms[lcword]++;
              else docTerms[lcword] = 1;
            }
          }
        });
      }
    }
  }
  obj._terms = [];
  for (var term in docTerms) {
    obj._terms.push(term);
  }
  console.log(JSON.stringify(obj));
}).on('close', function() {
});

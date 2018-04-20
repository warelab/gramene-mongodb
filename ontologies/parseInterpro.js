// download interpro and uncompress before running this script
// 'ftp://ftp.ebi.ac.uk/pub/databases/interpro/interpro.xml.gz';
// 'ftp://ftp.ebi.ac.uk/pub/databases/interpro/ParentChildTreeFile.txt'


var parentChildFile = process.argv[2];
var xmlFile = process.argv[3];
var collections = require('gramene-mongodb-config');

var fs        = require('fs')
  , XmlStream = require('xml-stream');

var mongoDomainsPromise = collections.domains.mongoCollection();


// read the parentChildFile into memory
var ancestors = {}; // key is child, value is list of ancestors
var currentNodes = [];
var currentDepth = 0;
require('readline').createInterface({
  input: fs.createReadStream(parentChildFile),
  terminal: false
}).on('line', function(line) {
  var splittedLine = line.split('--');
  var depth = splittedLine.length - 1;
  var IPRwithNames = splittedLine[depth];
  var splittedIPR = IPRwithNames.split('::');
  var IPR = parseInt(splittedIPR[0].match(/\d+/));
  currentNodes[depth] = IPR;
  ancestors[IPR] = [];
  for (var i = depth; i>=0; i--) {
    ancestors[IPR].push(currentNodes[i])
  }
}).on('close', function() {
  // Create a file stream and pass it to XmlStream
  var stream = fs.createReadStream(xmlFile);
  var xml = new XmlStream(stream);

  xml.collect('db_xref');
  xml.on('endElement: interpro', function(item) {
    // console.log(item);
    var obj = {};
    obj._id = parseInt(item.$.id.match(/\d+/));
    obj.ancestors = (ancestors[obj._id]) ? ancestors[obj._id] : [obj._id];
    obj.id = item.$.id;
    obj.name = item.$.short_name;
    obj.type = item.$.type;
    obj.description = item.name;
    if (item.hasOwnProperty('abstract') && item.abstract.hasOwnProperty('p')) obj.abstract = item.abstract.p.$text;
    if (item.hasOwnProperty('member_list') && item.member_list.hasOwnProperty('db_xref')) {
      item.member_list.db_xref.forEach(function(xref) {
        obj[xref.$.db] = xref.$.dbkey;
      });
    }
    if (item.hasOwnProperty('external_doc_list') && item.external_doc_list.hasOwnProperty('db_xref')) {
      item.external_doc_list.db_xref.forEach(function(xref) {
        obj[xref.$.db] = xref.$.dbkey;
      });
    }
    if (item.hasOwnProperty('structure_db_links') && item.structure_db_links.hasOwnProperty('db_xref')) {
      item.structure_db_links.db_xref.forEach(function(xref) {
        if (! obj.hasOwnProperty(xref.$.db)) obj[xref.$.db] = [];
        obj[xref.$.db].push(xref.$.dbkey);
      })
    }
    // console.log(JSON.stringify(obj));
    mongoDomainsPromise.then(function(domainsCollection) {
      domainsCollection.insertOne(obj, function(err, response) {
        if (err) {
          throw err;
        }
      });
    });
  });
  xml.on('end', function() {
    collections.closeMongoDatabase()
  })
});

var filename = process.argv[2];

var fs        = require('fs')
  , XmlStream = require('xml-stream');

// Create a file stream and pass it to XmlStream
var stream = fs.createReadStream(filename);
var xml = new XmlStream(stream);

// xml.preserve('interpro', true);
xml.collect('db_xref');
xml.on('endElement: interpro', function(item) {
  // console.log(item);
  var obj = {};
  obj._id = parseInt(item.$.id.match(/\d+/));
  obj.id = item.$.id;
  obj.short_name = item.$.short_name;
  obj.type = item.$.type;
  obj.name = item.name;
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
  console.log(JSON.stringify(obj));
  // xml.pause();
});

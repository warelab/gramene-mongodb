// download interpro and uncompress before running this script
// 'ftp://ftp.ebi.ac.uk/pub/databases/interpro/interpro.xml.gz';
// 'ftp://ftp.ebi.ac.uk/pub/databases/interpro/ParentChildTreeFile.txt'


var parentChildFile = process.argv[2];
var xmlFile = process.argv[3];
var collections = require('gramene-mongodb-config');

var fs        = require('fs')
  , parser    = require('fast-xml-parser');
var mongoDomainsPromise = collections.domains.mongoCollection();

function get_xrefs(x) {
  return Array.isArray(x) ? x : [x];
}

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
	console.error("finished reading parentChildFile. started to parse xmlFile");

	fs.readFile(xmlFile, 'utf8', function(err, xmlData) {
		if (err) {
			throw(err);
		}
		var n_inserted=0;
		console.log('readFile finished');
		var options = {
			attributeNamePrefix: "@_",
			ignoreAttributes: false,
			parseAttributeValue: true
		};
		var jsObj = parser.parse(xmlData,options);
		var total_items = jsObj.interprodb.interpro.length;
		console.log('parsed',total_items);
		jsObj.interprodb.interpro.forEach(function(item) {
			var obj = {}
			obj._id = parseInt(item["@_id"].match(/\d+/));
			obj.ancestors = (ancestors[obj._id]) ? ancestors[obj._id] : [obj._id];
			obj.id = item["@_id"];
			obj.name = item["@_short_name"];
			obj.type = item["@_type"];
			obj.description = item.name;
			if (item.hasOwnProperty('abstract') && item.abstract.hasOwnProperty('p')) obj.abstract = item.abstract.p["#text"];
	    if (item.hasOwnProperty('member_list') && item.member_list.hasOwnProperty('db_xref')) {
	      get_xrefs(item.member_list.db_xref).forEach(function(xref) {
	        if (! obj.hasOwnProperty(xref["@_db"])) obj[xref["@_db"]] = [];
	        obj[xref["@_db"]].push(xref["@_dbkey"]);
	      });
	    }
	    if (item.hasOwnProperty('external_doc_list') && item.external_doc_list.hasOwnProperty('db_xref')) {
	      get_xrefs(item.external_doc_list.db_xref).forEach(function(xref) {
	        if (! obj.hasOwnProperty(xref["@_db"])) obj[xref["@_db"]] = [];
	        obj[xref["@_db"]].push(xref["@_dbkey"]);
	      });
	    }
	    if (item.hasOwnProperty('structure_db_links') && item.structure_db_links.hasOwnProperty('db_xref')) {
	      get_xrefs(item.structure_db_links.db_xref).forEach(function(xref) {
	        if (! obj.hasOwnProperty(xref["@_db"])) obj[xref["@_db"]] = [];
	        obj[xref["@_db"]].push(xref["@_dbkey"]);
	      })
	    }
	    mongoDomainsPromise.then(function(domainsCollection) {
	      domainsCollection.insertOne(obj, function(err, response) {
	        if (err) {
	          throw err;
	        }
		n_inserted++;
	      });
	    });
	});
	function check_if_done() {
	        console.log(n_inserted,"inserted");
		if (n_inserted === total_items) {
			collections.closeMongoDatabase();
		}
		else {
			setTimeout(check_if_done, 1000);
		}
	}
	check_if_done();
	});


});


var sanitize = require('mongo-sanitize')
  , isNumber = require("isnumber");

function buildQuery(params, properties) {
  for (var p in params) {
    params[p] = sanitize(params[p]);
  }
  var qExprs = [];
  // free text query
  if (params.hasOwnProperty('q')) qExprs.push({'$text': {'$search': params['q']}});
  // location query
  if (params.hasOwnProperty('l')) {
    var a = params['l'].split(':');
    var m = a[0], r = a[1], s = a[2], e = a[3];
    qExprs.push(
      {'location.map':m},
      {'location.region':r},
      {'location.start':{'$lte': +e}},
      {'location.end':{'$gte': +s}});
  }
  for (var p in params) {
    if (!properties.hasOwnProperty(p)) {
      if (p === 'idList') qExprs.push({'_id': {'$in': params['idList'].split(',').map(function(x) {return isNumber(x) ? +x : x;})}});
      else {
        var expr = {};
        if (Array.isArray(params[p])) {
          expr[p] = {'$in': params[p].map(function(x) {return isNumber(x) ? +x : x;})};
        }
        else {
          expr[p] = params[p];
        }
        qExprs.push(expr);
      }
    }
  }
  if (qExprs.length > 1) return {'$and': qExprs};
  else if (qExprs.length == 1) return qExprs[0];
  else return {};
}

module.exports = {
  select : {
    description : "search interface",
    properties : {
      q: {
        type: "string",
        description: "query string"
      },
      l: {
        type: "string",
        pattern: '^[^:]+:[^:]+:[0-9]+:[0-9]+$',
        description: "query location"
      },
      rows: {
        type: "integer",
        description: "number of rows to return"
      },
      start: {
        type: "integer",
        description: "return documents starting at row"
      },
      fl: {
        type: "string",
        description: "list of fields to return"
      }
    },
    run: function(c, params, req,  res) {
      var query = buildQuery(params, this.properties);
      var options = {};
      if (params.hasOwnProperty('rows')) {
        if (params['rows'] !== -1) options['limit'] = params['rows'];
      }
      else options['limit'] = 20;
      if (params.hasOwnProperty('start')) options['skip'] = params['start'];
      if (params.hasOwnProperty('fl')) {
        options['fields'] = {};
        var want_id=false;
        params['fl'].split(',').forEach(function(f) {
          options['fields'][f] = 1;
          if (f === '_id') want_id=true;
        });
        if (!want_id) options['fields']['_id'] = 0;
      }
      c.coll.find(query, options).toArray(function(err, result) {
        if (err) throw err;
        res.send(result);
      });
    }
  }
};
// setup some dependencies
var cluster = require('cluster'),
    express = require('express'),
    cors = require('cors'),
    compression = require('compression'),
    cache = require('web-cache'),
    validate = require('conform').validate,
    sanitize = require('mongo-sanitize'),
    MongoClient = require('mongodb').MongoClient,
    ObjectId = require('mongodb').ObjectID,
    fastbit = require('fastbit'),
    isNumber = require("isnumber");

if (cluster.isMaster) {
  // Count the machine's CPUs
  var cpuCount = require('os').cpus().length;

  // Create a worker for each CPU
  for (var i = 0; i < cpuCount; i += 1) {
    cluster.fork();
  }
  // Listen for dying workers
  cluster.on('exit', function (worker) {
    // Replace the dead worker, we're not sentimental
    console.log('Worker ' + worker.id + ' died :(');
    cluster.fork();
  });
}
else {
// load settings from config file
var settings = require('./config/settings.json');
var collections = require('./config/collections').collections;
var MongoAPI = require('./config/api').mongo;
var FastBitAPI = require('./config/api').fastbit;

// add mongodb collections to the external services
var services = settings.externalServices;
for (var c in collections) {
  services['/' + c] = collections[c].description;
}

// setup mongodb collections
var databases = {};
for (var coll in collections) {
  var c = collections[coll];
  if (databases.hasOwnProperty(c.dbName)) {
    databases[c.dbName].colls.push(coll);
  }
  else {
    databases[c.dbName] = {
      url: 'mongodb://' + c.host + ':' + c.port + '/' + c.dbName,
      colls: [coll]
    };
  }
}
for (var dbName in databases) {
  (function(url, colls) {
    MongoClient.connect(url, function(err, db) {
      if (err) throw err;
      console.log('connected to ' + url, colls);
      colls.forEach(function (coll) {
        var c = collections[coll];
        c.coll = db.collection(c.collectionName);
      });
    });
  })(databases[dbName].url, databases[dbName].colls);
}

function buildQuery(params, cmd) {
  for (var p in params) {
    params[p] = sanitize(params[p]);
  }
  var qExprs = [];
  if (params.hasOwnProperty('q')) qExprs.push({'$text': {'$search': params['q']}});
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
    if (!cmd.hasOwnProperty(p)) {
      if (p === 'idList') qExprs.push({'_id': {'$in': params['idList'].split(',').map(function(x) {return isNumber(x) ? +x : x;})}});
      else {
        var o = {};
        if (Array.isArray(params[p])) {
          o[p] = {'$in': params[p].map(function(x) {return isNumber(x) ? +x : x;})};
        }
        else {
          o[p] = params[p];
        }
        qExprs.push(o);
      }
    }
  }
  if (qExprs.length > 1) return {'$and': qExprs};
  else if (qExprs.length == 1) return qExprs[0];
  else return {};
}

// the actual mongodb queries for each API command
var MongoCommand = {
  describe: function(c, params, req, res) {
    res.send(c.properties);
  },
  select : function(c, params, req,  res) {
    var query = buildQuery(params, MongoAPI.select.properties);
    var time = process.hrtime();
    c.coll.count(query, function(err, count) {
      if (err) throw err;
      var options = {};
      if (params.hasOwnProperty('rows')) {
        if (params['rows'] !== -1) options['limit'] = params['rows'];
      }
      else options['limit'] = 20;
      if (params.hasOwnProperty('start')) options['skip'] = params['start'];
      if (params.hasOwnProperty('sort')) {
        options['sort'] = {}; // not implemented yet
      }
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
        var diff = process.hrtime(time);
        var ms = diff[0] * 1e3 + diff[1]/1e6;
        res.send({time: ms, count: count, response:result});
      });
    });
  },
  facet : function(c, params, req, res) {
    var pipeline = [];
    var query = buildQuery(params, MongoAPI.facet.properties);
    if (query.length !== 0) {
      pipeline.push({$match : query});
    }
    // this doesn't work for multi valued fields
    // if the field is multi valued you have to $unwind(?) it first
    pipeline.push({$group : {_id: '$'+params['field'], count: {$sum:1}}});
    pipeline.push({$sort  : {count:-1}});
    c.coll.aggregate(pipeline, function(err, result) {
       if (err) throw err;
       res.send(result);
    });
  }
};
// The FastBit API commands
var FastBitCommand = {
  columns: function(c, params, req, res) {
    // need to find the path to the requested featureSet
    // first lookup the map id and the featureSet name
    c.coll.findOne({_id: new ObjectId(params['featureSet'])},function(err, featureSet) {
      if (err) throw err;
      // need to look up the system_name for this map
      collections['maps'].coll.findOne({_id: featureSet.map},function(err, map) {
        if (err) throw err;
        params.from = c.dataDirectory+'/'+map.system_name+'/'+featureSet.map+'/'+featureSet.name;
        res.send(fastbit.describe(params));
      });
    });
  },
  sql: function(c, params, req, res) {
    // need to find the path to the requested featureSet
    // first lookup the map id and the featureSet name
    c.coll.findOne({_id: new ObjectId(params['featureSet'])},function(err, featureSet) {
      if (err) throw err;
      // need to look up the system_name for this map
      collections['maps'].coll.findOne({_id: featureSet.map},function(err, map) {
        if (err) throw err;
        params.from = c.dataDirectory+'/'+map.system_name+'/'+featureSet.map+'/'+featureSet.name;
        res.send(fastbit.SQL(params));
      });
    });
  },
  histogram: function(c, params, req, res) {
    // need to find the path to the requested featureSet
    // first lookup the map id and the featureSet name
    c.coll.findOne({_id: new ObjectId(params['featureSet'])},function(err, featureSet) {
      if (err) throw err;
      // need to look up the system_name for this map
      collections['maps'].coll.findOne({_id: featureSet.map},function(err, map) {
        if (err) throw err;
        params.from = c.dataDirectory+'/'+map.system_name+'/'+featureSet.map+'/'+featureSet.name;
        res.send(fastbit.histogram(params));
      });
    });
  }
};

var app = express();

// var corsOptionsDelegate = function(req, callback){
//   var corsOptions = {credentials: true, origin: false};
//   if(settings.CORS.indexOf(req.header('Origin')) !== -1){
//     corsOptions.origin = true; // reflect (enable) the requested origin in the CORS response
//   }
//   callback(null, corsOptions); // callback expects two parameters: error and options
// };
//
// app.use(cors(corsOptionsDelegate));
app.use(cors());
app.use(compression());
app.use(cache.middleware({
  clean: true
}));

var port = process.argv.length > 2 ? process.argv[2] : 3000;

// define routes
app.get('/', function (req, res, next) { // return top level info
  res.json(services);
});

app.get('/:collection', function (req, res, next) {
  // check if the collection exists
  var c = req.params.collection;
  if (collections.hasOwnProperty(c)) {
    if (c === 'features') res.json({featureSet:MongoAPI,features:FastBitAPI});
    else res.json(MongoAPI);
  }
  else res.json({"error":" '"+c+"' not found"});
});

app.get('/:collection/:command', function (req, res, next) {
  // check if the collection exists
  var c = req.params.collection;
  if (collections.hasOwnProperty(c)) {
    var cmd = req.params.command;
    if (MongoAPI.hasOwnProperty(cmd)) { // cmd exists
      if (MongoAPI[cmd].hasOwnProperty("properties")) { // validate cmd params
        var check1 = validate(req.query, MongoAPI[cmd], {cast: true, castSource: true});
        if (check1['valid']) { // validate collection specific params
          var check2 = validate(req.query, collections[c], {cast: true, castSource: true});
          if (check2['valid']) MongoCommand[cmd](collections[c], req.query, req, res);
          else res.json(check2);
        }
        else res.json(check1);
      }
      else MongoCommand[cmd](collections[c], req.query, req, res);
    }
    else if (c === 'features' && FastBitAPI.hasOwnProperty(cmd)) { // its a fastbit command
      if (FastBitAPI[cmd].hasOwnProperty("properties")) { // validate cmd params
        var check = validate(req.query, FastBitAPI[cmd], {cast: true, castSource: true});
        if (check['valid']) FastBitCommand[cmd](collections[c], req.query, req, res);
        else res.json(check);
      }
      else FastBitCommand[cmd](collections[c], req.query, req, res);
    }
    else res.json({"error":" command '"+cmd+"' is invalid","api" : FastBitAPI});
  }
  else res.json({"error":" collection '"+c+"' does not exist"});
});

var server = app.listen(port, function() {
    console.log('Listening on port %d', server.address().port);
});
}
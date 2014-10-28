// setup some dependencies
var express  = require('express'),
    cors = require('cors'),
    compression = require('compression'),
    cookieParser = require('cookie-parser'),
    session = require('express-session'),
    MongoStore = require('connect-mongo')(session),
    cache    = require('web-cache'),
    validate = require('conform').validate,
    MongoClient  = require('mongodb').MongoClient;

// load settings from config file
var settings = require('./config/settings.json');
var collections = require('./config/collections').collections;
var MongoAPI = require('./config/api').api;

// setup mongodb collections
var mongoURL = 'mongodb://' + settings.mongo.host + ':' + settings.mongo.port + '/';
var databases = {};
for (var coll in collections) {
  var c = collections[coll];
  if (! databases.hasOwnProperty(c.dbName)) { // open database connection
    (function(c) {
      MongoClient.connect(mongoURL + c.dbName, function(err,db) {
        if (err) throw err;
        databases[c.dbName] = db;
        c.coll = databases[c.dbName].collection(c.collectionName);
      });
    })(c);
  }
  else c.coll = databases[c.dbName].collection(c.collectionName);
}

function buildQuery(params,api) {
  var qExprs = [];
  if (params.hasOwnProperty('q')) qExprs.push({'$text': {'$search':params['q']}});
  for (var p in params) {
    if (!api.hasOwnProperty(p)) {
      qExprs.push({p:params[p]});
    }
  }
  if (qExprs.length > 1) return {'$and':qExprs};
  else if (qExprs.length == 1) return qExprs[0];
  else return {};
}

// the actual mongodb queries for each API command
var MongoCommand = {
  describe: function(c, params, req, res) {
    res.send(c.properties);
  },
  select : function(c,params,req,res) {
    var query = buildQuery(params,MongoAPI.select.properties);
    var time = process.hrtime();
    c.coll.count(query, function(err,count) {
      if (err) throw err;
      var options = {};
      if (params.hasOwnProperty('rows')) options['limit'] = params['rows'];
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
      c.coll.find(query,options).toArray(function(err,result) {
        if (err) throw err;
        var diff = process.hrtime(time);
        var ms = diff[0] * 1e3 + diff[1]/1e6;
        res.send({time: ms, count: count, response:result});
        if (params.hasOwnProperty('hist')) {
          var now = new Date(Date.now());
          var remember = {
            timestamp : now.toISOString(),
            collection : req.params.collection,
            query : query,
            count : count
          };
          if (req.session.history) req.session.history.push(remember);
          else req.session.history = [remember];
        }
      });
    });
  },
  facet : function(c,params,req,res) {
    var pipeline = [];
    var query = buildQuery(params,MongoAPI.facet.properties);
    if (query.length !== 0) {
      pipeline.push({$match : query});
    }
    // this doesn't work for multi valued fields
    // if the field is multi valued you have to $unwind(?) it first
    pipeline.push({$group : {_id: '$'+params['field'], count: {$sum:1}}});
    pipeline.push({$sort  : {count:-1}});
    c.coll.aggregate(pipeline,function(err,result) {
       if (err) throw err;
       res.send(result);
    });
  }
};


var app = express();

var corsOptionsDelegate = function(req, callback){
  var corsOptions = {credentials: true, origin: false};
  if(settings.CORS.indexOf(req.header('Origin')) !== -1){
    corsOptions.origin = true; // reflect (enable) the requested origin in the CORS response
  }
  callback(null, corsOptions); // callback expects two parameters: error and options
};

app.use(cors(corsOptionsDelegate));
app.use(compression());
app.use(cookieParser(settings.cookie_secret));
app.use(session({
  store: new MongoStore(settings.session),
  secret: settings.cookie_secret,
  resave: false,
  saveUninitialized: true
}));
app.use(cache.middleware({
  clean: true,
  exclude: [ /^\/history/ ]
}));

var port = process.argv.length > 2 ? process.argv[2] : 3000;

// define routes
app.get('/', function (req,res,next) { // return top level info
  var info = { '/ensembl' : "ensembl REST API" };
  for (var c in collections) {
    info['/' + c] = collections[c].description;
  }
  res.json(info);
});

app.get('/history', function (req,res,next) {
  if (req.query.hasOwnProperty('clear')) req.session.history = [];
  res.json(req.session.history);
});

app.get('/:collection', function (req, res, next) {
  // check if the collection exists
  var c = req.params.collection;
  if (collections.hasOwnProperty(c)) res.json(MongoAPI);
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
    else res.json({"error":" command '"+cmd+"' is invalid","api" : MongoAPI});
  }
  else res.json({"error":" collection '"+c+"' does not exist"});
});

var server = app.listen(port, function() {
    console.log('Listening on port %d', server.address().port);
});

// setup some dependencies
var express  = require('express'),
    compression = require('compression'),
    cookieParser = require('cookie-parser'),
    session = require('express-session'),
    MongoStore = require('connect-mongo')(session),
    validate = require('conform').validate,
    MongoClient  = require('mongodb').MongoClient;

var settings = require('./config/settings.json');

var app = express();
app.use(compression());
app.use(cookieParser(settings.cookie_secret));
app.use(session({
    store: new MongoStore(settings.session),
    secret: settings.cookie_secret,
    resave: false,
    saveUninitialized: true
}));

// a few standard mongodb commands (mimic solr)
var MongoAPI = {
    select : {
        description: "search interface",
        properties: {
            q: {
                type: 'string',
                description: 'query string'
            },
            rows: {
                type: 'integer',
                description: 'number of rows to return'
            },
            start: {
                type: 'integer',
                description: 'return documents starting at row'
            },
            fl: {
                type: 'string',
                description: 'list of fields to return'
            },
            sort: {
                type: 'string',
                description: 'sort criteria'
            }
        }
    },
    facet : {
        description: "field facet counting",
        properties: {
            q: {
                type: 'string',
                description: 'query string'
            },
            field: {
                type: 'string',
                description: 'field to count values',
                required: true
            }
        }
    }
};

var mongoURL = 'mongodb://' + settings.mongo.host + ':' + settings.mongo.port + '/';
var databases = settings.databases;

// the actual mongodb queries for each API command
var MongoCommand = {
    select : function(coll,params,schema,req,res) {
        var query = {};
        if (params.hasOwnProperty('q')) query['$text'] = {'$search':params['q']};
        for (var p in params) {
            if (!schema.hasOwnProperty(p)) {
                query[p] = params[p];
            }
        }
        var time = process.hrtime();
        coll.count(query, function(err,count) {
            if (err) throw err;
            var diff = process.hrtime(time);
            var ms = diff[0] * 1e3 + diff[1]/1e6;
            var remember = {
                timestamp : Date.now()/1000,
                query : query,
                count : count
            };
            if (req.session.history) req.session.history.push(remember);
            else req.session.history = [remember];

            var options = {};
            if (params.hasOwnProperty('rows')) options['limit'] = params['rows'];
            if (params.hasOwnProperty('start')) options['skip'] = params['start'];
            if (params.hasOwnProperty('sort')) {
                options['sort'] = {};
            }
            if (params.hasOwnProperty('fl')) {
                options['fields'] = {};
            }
            coll.find(query,options).toArray(function(err,result) {
                if (err) throw err;
                res.send({time: ms, count: count, response:result});
            });
        });
    },
    facet : function(coll,params,schema,req,res) {
        var pipeline = [];
        var query = {};
        if (params.hasOwnProperty('q')) query['$text'] = {'$search':params['q']};
        for (var p in params) {
            if (!schema.hasOwnProperty(p)) {
                query[p] = params[p];
            }
        }
        if (query.length !== 0) {
            pipeline.push({$match : query});
        }
        // this doesn't work for multi valued fields
        // if the field is multi valued you have to $unwind(?) it first
        pipeline.push({$group : {_id: '$'+params['field'], count: {$sum:1}}});
        pipeline.push({$sort  : {count:-1}});
        console.log("pipeline",pipeline);
        coll.aggregate(pipeline,function(err,result) {
           if (err) throw err;
           res.send(result);
        });
    }
};

// open database connections
for (var dbname in databases) {
    (function(dbname) {
        MongoClient.connect(mongoURL + databases[dbname].url, function(err,db) {
            if (err) throw err;
            databases[dbname].db = db;
        });
    })(dbname);
}

var port = process.argv.length > 2 ? process.argv[2] : 3000;

// define routes
app.get('/', function (req,res,next) {
    // return top level api
    var dbinfo = {};
    for (var dbname in databases) {
        dbinfo[dbname] = databases[dbname].collections;
    }
    res.json(dbinfo);
});

app.get('/history', function (req,res,next) {
    res.json(req.session.history);
});

app.get('/:dbname', function (req, res, next) {
    // return a list of collections in the given database
    var dbname = req.params.dbname;
    if (databases.hasOwnProperty(dbname)) {
        res.json(databases[dbname].collections);
    }
    else {
        res.json({"error":"db '"+dbname+"' not found"});
    }
});

app.get('/:dbname/:collection', function (req, res, next) {
    // send some summary info on the collection
    // maybe db.collection.stats()?
    // and a list of commands that make sense for the collection
    var dbname = req.params.dbname;
	var collection = req.params.collection;
    if (databases.hasOwnProperty(dbname)
    && databases[dbname].collections.hasOwnProperty(collection)) {
        res.json(MongoAPI);
    }
    else {
        res.json({"error":"collection '"+dbname+"."+collection+"' not found"});
    }
});

app.get('/:dbname/:collection/:command', function (req, res, next) {
   var dbname = req.params.dbname;
   var collection = req.params.collection;
   var cmd = req.params.command;
   if (databases.hasOwnProperty(dbname)
   && databases[dbname].collections.hasOwnProperty(collection)) {
       if (MongoAPI.hasOwnProperty(cmd)) {
           // validate command
           var check = validate(req.query, MongoAPI[cmd], {cast:true,castSource:true});
           if (check['valid']) {
               // run command
               var db = databases[dbname].db;
               var coll = db.collection(collection);
               MongoCommand[cmd](coll,req.query,MongoAPI[cmd].properties,req,res);
           } else {
               res.json(api[cmd].properties);
           }
       }
       else {
           res.json({"error": "command '"+cmd+"' not defined in api", api:MongoAPI});
       }
   }
   else {
       res.json({"error":"collection '"+dbname+"."+collection+"' not found"});
   }
});

var server = app.listen(port, function() {
    console.log('Listening on port %d', server.address().port);
});

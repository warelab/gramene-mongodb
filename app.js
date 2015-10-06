var cluster = require('cluster')
  , express = require('express')
  , cors = require('cors')
  , compression = require('compression')
  , cache = require('web-cache')
  , validate = require('conform').validate
  , MongoClient = require('mongodb').MongoClient
  , MongoCommands = require('./MongoCommands')
  , collections = require('./config/collections');
  
var port = process.argv.length > 2 ? process.argv[2] : 3000;

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
  console.log('Starting up worker '+cluster.worker.id);
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
        console.log('Worker '+cluster.worker.id+': connected to ' + url, colls);
        colls.forEach(function (coll) {
          var c = collections[coll];
          c.coll = db.collection(c.collectionName);
        });
      });
    })(databases[dbName].url, databases[dbName].colls);
  }


  var app = express();

  app.use(cors());
  app.use(compression());
  app.use(cache.middleware({
    clean: true
  }));

  var port = process.argv.length > 2 ? process.argv[2] : 3000;

  function processRequest(cname, command, req, res) {
    if (collections.hasOwnProperty(cname)) {
      var c = collections[cname];
      if (MongoCommands.hasOwnProperty(command)) {
        var cmd = MongoCommands[command];
        // validate query parameters
        var check = validate(req.query, cmd, {cast: true, castSource: true});
        if (check['valid']) {
          // run the command
          cmd.run(c, req.query, req, res);
        }
        else {
          // report validation errors
          res.json(check);
        }
      }
      else {
        // invalid command
        res.json({"error":"command '"+cmd+"' is invalid.", "commands": Object.keys(MongoCommands)});
      }
    }
    else {
      // invalid collection
      res.json({"error":"collection '"+cname+"' not found.", "collections": Object.keys(collections)});
    }
  }

  app.get('/', function (req, res, next) {
    res.json({
      "message":"the gramene-mongodb server is up",
      "routes":Object.keys(collections).map(function(cname) {
        return 'http://data.gramene.org/'+cname;
      })});
  });

  app.get('/:collection', function (req, res, next) {
    processRequest(req.params.collection, 'select', req, res);
  });

  app.get('/:collection/:command', function (req, res, next) {
    processRequest(req.params.collection, req.params.command, req, res);
  });

  var server = app.listen(port, function() {
      console.log('Listening on port %d', server.address().port);
  });
}

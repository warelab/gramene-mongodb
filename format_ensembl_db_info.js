#!/usr/bin/env node
var argv = require('minimist')(process.argv.slice(2));
var lineReader = require('line-reader');
var compara = argv.c;
var cores = [];
var variations = [];
lineReader.eachLine(argv.v, function(variation, isLast) {
  variations.push({
    host: argv.h,
    port: 3306,
    user: argv.u,
    password: argv.p,
    database: variation
  });
  if (isLast) {
    lineReader.eachLine(argv.o, function(core, isLast) {
      cores.push({
        host: argv.h,
        port: 3306,
        user: argv.u,
        password: argv.p,
        database: core
      });
      if (isLast) {
        console.log(JSON.stringify({
          compara: {
            host: argv.h,
            user: argv.u,
            password: argv.p || '',
            database: compara
          },
          cores: cores,
          variations: variations
        }, null, ' '));
      }
    });
  }
})

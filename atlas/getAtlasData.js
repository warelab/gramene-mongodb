#!/usr/bin/env node
var _ = require('lodash');
var Q = require('q');
var fs = require('fs');
var collections = require('gramene-mongodb-config');

// update_tid: remap an EBI Atlas organism taxon to a genome taxon. Atlas tags some experiments with
// a subspecies/cultivar taxon BELOW a genome's species (e.g. maize subsp. 381124 under Zea mays 4577);
// those are absent from the local gramene `taxonomy` (genome taxa + ancestors only) so the inclusion
// test below would drop them. build_taxon_remap.js precomputes a complete descendant->genome map from
// the compara ncbi_taxa_node tree; load it here. The hardcoded 381124->4577 stays as a fallback for
// when the remap file is absent (it is also produced dynamically).
var update_tid = {};
update_tid[381124] = 4577; // fallback special case for maize subspecies
try {
  var remapPath = require('path').join(__dirname, 'taxon_remap.json');
  if (fs.existsSync(remapPath)) {
    var dyn = JSON.parse(fs.readFileSync(remapPath, 'utf8'));
    Object.keys(dyn).forEach(function (k) { update_tid[k] = dyn[k]; });
    console.error('loaded ' + Object.keys(dyn).length + ' descendant->genome taxon remaps from taxon_remap.json');
  } else {
    console.error('taxon_remap.json not found — using static taxon remap only (run build_taxon_remap.js)');
  }
} catch (e) {
  console.error('taxon_remap.json load failed (' + (e && e.message) + ') — using static taxon remap only');
}

// ONLY: restrict this run to specific experiment accessions (comma separated). Used by the
// incremental `make add-studies` path so one new study can be fetched and loaded without
// re-downloading and re-inserting all ~360 experiments. Unset = every experiment, as before.
var ONLY = null;
if (process.env.ONLY) {
  ONLY = new Set(String(process.env.ONLY).split(/[,\s]+/).filter(Boolean));
  console.error('ONLY: restricting to ' + ONLY.size + ' experiment(s): ' + [...ONLY].join(', '));
}

var seen = {};
function parseAssays() {
  var deferred = Q.defer();
  var assays = {};
  // organism label -> taxon id, harvested from the rows that DO carry an NCBITaxon URI. Used to
  // fill in the rows that don't; see the close handler.
  var labelTaxon = {};
  require('readline').createInterface({
    input: require('fs').createReadStream(process.argv[2]),
    terminal: false
  })
  .on('line', function(line) {
    var fields = line.split("\t");
    var contrast = fields[1].match(/(g\d+)_(g\d+)/);
    if (contrast) {
      fields[1] = fields[2] === "reference" ? contrast[1] : contrast[2];
      fields.splice(2,1);
    }
    var _id = fields[0] + '_' + fields[1];
    if (!assays.hasOwnProperty(_id)) {
      assays[_id] = {
        'experiment' : fields[0],
        'group'      : fields[1],
        'characteristic' : [],
        'factor' : []
      }
    }
    const prop_key = [_id,fields[2],fields[3],fields[4]].join("\t");
    if (! seen.hasOwnProperty(prop_key)) {
      seen[prop_key] = true;
      var info = { type: fields[3], label: fields[4] };
      if (fields.length === 6) {
        var matches = fields[5].match(/.*\/([A-Za-z]+)_(\d+)/);
        if (matches) {
          info.ontology = matches[1];
          info.id = matches[1] + ':' + matches[2];
          info.int_id = +matches[2];
        }
      }
    
      assays[_id][fields[2]].push(info);
      if (fields[3] === 'organism') {
        // fields[4] is the organism label, fields[5] the ontology URI. The URI column can be
        // present-but-empty, and (defensively) absent altogether. The old code did
        // `+fields[5].replace(...)`, which yields 0 for an empty column and throws for a missing
        // one -- so a dump without the URI silently produced taxon_id 0 and the experiment was
        // dropped by the taxonomy test below with no warning at all.
        var label = (fields[4] || '').trim();
        var uri = (fields.length > 5 && fields[5] != null) ? fields[5] : '';
        var taxonMatch = /NCBITaxon_(\d+)/.exec(uri);
        if (taxonMatch) {
          var tid = +taxonMatch[1];
          if (label) labelTaxon[label] = tid;
          assays[_id].taxon_id = update_tid[tid] || tid;
        } else if (label) {
          // Defer: the label may only be resolvable from a row further down the file.
          assays[_id].organism_label = label;
        }
      }
    }
  })
  .on('close', function() {
    // Fill in any assay group whose organism row carried no NCBITaxon URI, using the label->taxon
    // evidence collected from the rows that did. Resolving against the file's own evidence rather
    // than the local `taxonomy` collection is deliberate: taxonomy stores munged genome display
    // names ("Zea maysB73" for the Atlas's "Zea mays", "Oryza sativa Japonica Group" for its
    // "Oryza sativa japonica"), so a name match there would miss exactly those. Verified
    // unambiguous across both Atlas dumps: 68 distinct organism labels, none mapping to more than
    // one taxon id.
    var recovered = 0, noOrganism = 0, unresolved = {};
    _.forEach(assays, function (a) {
      var label = a.organism_label;
      delete a.organism_label;
      if (a.taxon_id) return;
      if (!label) { noOrganism++; return; }
      var tid = labelTaxon[label];
      if (tid) {
        a.taxon_id = update_tid[tid] || tid;
        recovered++;
      } else {
        unresolved[label] = (unresolved[label] || 0) + 1;
      }
    });
    if (recovered) {
      console.error('recovered taxon_id for ' + recovered + ' assay group(s) from the organism ' +
                    'label (the dump carried no NCBITaxon URI for them)');
    }
    Object.keys(unresolved).forEach(function (label) {
      console.error('WARNING: organism "' + label + '" has no NCBITaxon URI anywhere in this dump; ' +
                    unresolved[label] + ' assay group(s) have no taxon and will be skipped');
    });
    if (noOrganism) {
      console.error('WARNING: ' + noOrganism + ' assay group(s) had no organism characteristic at all');
    }
    var experiments = _.groupBy(assays,'experiment');
    deferred.resolve(experiments);
  });
  return deferred.promise;
}

const gxa_url = 'https://ftp.ebi.ac.uk/pub/databases/microarray/data/atlas/experiments';

collections.taxonomy.mongoCollection().then(function(taxonomyCollection) {
  taxonomyCollection.find({subset:'gramene'},{_id:1,name:1}).toArray(function (err, docs) {
    var taxonomy = {};
    docs.forEach(function(doc) {
      taxonomy[doc._id] = doc.name;
    });
    var lut = {};
    parseAssays().then(function(experiments) {
      var experiment_metadata = {};
      var mongoAssays = [];
      _.forEach(experiments, function(experiment, id) {
        if (ONLY && !ONLY.has(id)) return;
        if (taxonomy.hasOwnProperty(experiment[0].taxon_id)) {
          if (!experiment_metadata.hasOwnProperty(id)) {
            experiment_metadata[id] = {
              taxon_id : experiment[0].taxon_id
            };
          }
          // console.log(`curl -O ${gxa_url}/${id}/${id}-tpms.tsv`)
          experiment.forEach(function(e) {
            e._id = e.experiment + "." + e.group;
          });
          Array.prototype.push.apply(mongoAssays,experiment);
        }
      });
      // get the experiments metadata from https://www.ebi.ac.uk/gxa/json/experiments
      var mongoExperiments = [];
      var url = 'https://www.ebi.ac.uk/gxa/json/experiments'
      console.error('gxa get('+url+')');
      fetch(url)
      .then(res => res.json())
      .then(obj => {
        obj.experiments.forEach(e => {
          if (experiment_metadata[e.experimentAccession]) {
            var id = e.experimentAccession;
            var em = experiment_metadata[id];
            em.description = e.experimentDescription;
            em._id = id;
            em.source = "EBI";
            em.type = e.experimentType;
            // factors: the experimental variables (e.g. ["developmental stage","organism part"]).
            // Comes straight from the GXA experiments JSON; was dropped from this build, so
            // experiments lost their `factors` field (restored to match v10).
            em.factors = e.experimentalFactors || [];
            if (e.rawExperimentType === "RNASEQ_MRNA_BASELINE") {
              console.log(`curl -O ${gxa_url}/${id}/${id}-tpms.tsv`)
              console.log(`curl -O ${gxa_url}/${id}/${id}-factors.xml`)
              console.log(`curl -O ${gxa_url}/${id}/${id}-configuration.xml`)
              console.log(`curl -O ${gxa_url}/${id}/${id}.idf.txt`)
              mongoExperiments.push(em);
            }
            if (e.rawExperimentType === "RNASEQ_MRNA_DIFFERENTIAL") {
              console.log(`curl -O ${gxa_url}/${id}/${id}-analytics.tsv`)
              mongoExperiments.push(em);
            }
          }
        });
        console.error('parsed experiments?', mongoExperiments.length)
        // insert the assays and experiments to mongodb
        // Upsert rather than insertMany: both collections are keyed on _id (accession, and
        // accession.group), so replacing makes this idempotent. That is what lets 55_atlas add a
        // study without dropping the collections first.
        var upsertAll = function (col, docs) {
          if (!docs.length) return Promise.resolve(0);
          // $set, NOT replaceOne: 55_atlas merges the baseline landingPageDisplayName into
          // experiments.name AFTER this runs, and a replace would silently wipe it on the next
          // pass. $set updates the fields we own and leaves everything else alone.
          var ops = docs.map(function (d) {
            var set = {};
            Object.keys(d).forEach(function (k) { if (k !== '_id') set[k] = d[k]; });
            return { updateOne: { filter: { _id: d._id }, update: { $set: set }, upsert: true } };
          });
          return new Promise(function (resolve, reject) {
            col.bulkWrite(ops, { ordered: false }, function (err) { err ? reject(err) : resolve(docs.length); });
          });
        };
        collections.assays.mongoCollection().then(function(assayCol) {
          return upsertAll(assayCol, mongoAssays).then(function (n) {
            console.error('upserted ' + n + ' assay group(s)');
            return collections.experiments.mongoCollection().then(function(expCol) {
              return upsertAll(expCol, mongoExperiments).then(function (m) {
                console.error('upserted ' + m + ' experiment(s)');
                collections.closeMongoDatabase();
              });
            });
          });
        }).catch(function (e) {
          console.error('getAtlasData FAILED: ' + (e && e.message || e));
          process.exit(1);
        })
      });
    });
  });
});

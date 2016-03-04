#!/usr/bin/env node
var argv = require('minimist')(process.argv.slice(2));
var _ = require('lodash');
// connect to mysql database
var mysql = require('mysql');
var connectionOptions = {
  host: argv.h,
  user: argv.u,
  database: argv.d
}
var db_type = connectionOptions.database.match(/_(core|otherfeatures)_\d+_\d+_\d+/)[1];

if (!!argv.p) {
  connectionOptions.password = argv.p;
}
var connection = mysql.createConnection(connectionOptions);
if (!connection) throw "error";
connection.connect();

// lookup metadata
var get_metadata = {
  sql: 'select meta_key,meta_value from meta',
  process: function(rows) {
    var meta = {};
    rows.forEach(function(row) {
      meta[row.meta_key] = row.meta_value;
    });
    return meta;
  }
};

var get_exons = {
  sql: 'select * from exon',
  process: function(rows) {
    var obj = {};
    rows.forEach(function(row) {
      obj[row.exon_id] = row;
    });
    return obj;
  }
}

var get_transcripts = {
  sql: 'select transcript_id,gene_id,stable_id from transcript',
  process: function(rows) {
    var obj = {};
    rows.forEach(function(row) {
      row.exons = [];
      row.exon_ids = [];
      row.length = 0;
      obj[row.transcript_id] = row;
    });
    return obj;
  }
}

var add_exons_to_transcripts = {
  sql: 'select * from exon_transcript',
  process: function(rows,exons,transcripts) {
    rows.forEach(function(row) {
      var exon = exons[row.exon_id];
      var transcript = transcripts[row.transcript_id];
      transcript.exons[row.rank-1] = exon.stable_id;
      transcript.exon_ids[row.rank-1] = row.exon_id; // needed for translation start and end
      transcript.length += exon.seq_region_end - exon.seq_region_start + 1;
    });
  }
}

var add_translations_to_transcripts = {
  sql: 'select t.translation_id,t.transcript_id,t.seq_start,t.seq_end,t.start_exon_id,t.end_exon_id,t.stable_id, CAST(ta.value AS UNSIGNED) as num_residues'
  + ' from translation t left join translation_attrib ta on ta.translation_id = t.translation_id and ta.attrib_type_id = 167',
  process: function(rows, exons, transcripts) {
    var obj={};
    rows.forEach(function(row) {
      var transcript = transcripts[row.transcript_id];
      // calculate the translation start and end coords relative to the transcript
      // and exon junctions
      transcript.exon_junctions = [];
      transcript.cds = {
        start: 0,
        end: 0
      };
      var pos=0;
      transcript.exon_ids.forEach(function(exon_id) {
        var exon = exons[exon_id];
        if (transcript.cds.start === 0 && exon_id === row.start_exon_id) {
          transcript.cds.start = pos + row.seq_start;
        }
        if (transcript.cds.end === 0 && exon_id === row.end_exon_id) {
          transcript.cds.end = pos + row.seq_end;
        }
        pos += exon.seq_region_end - exon.seq_region_start + 1;
        transcript.exon_junctions.push(pos);
      });
      transcript.exon_junctions.pop();
      if (transcript.exon_junctions.length === 0) {
        delete transcript.exon_junctions;
      }
      transcript.translation = {
        id : row.stable_id,
        length : row.num_residues,
        features: {all:[]}
      };
      obj[row.translation_id] = transcript.translation;
    });
    return obj;
  }
}

// get interpro protein features and add them to the corresponding translation object
var add_features_to_translations = {
  sql: 'SELECT tl.translation_id, ipr.interpro_ac, pf.seq_start, pf.seq_end, pf.hit_name, pf.hit_description, a.db'
   + ' FROM translation tl'
   + ' inner join protein_feature pf on tl.translation_id = pf.translation_id'
   + ' inner join interpro ipr on pf.hit_name = ipr.id'
   + ' inner join analysis a on pf.analysis_id = a.analysis_id'
   + ' WHERE 1',
  process: function(rows, translations) {
    rows.forEach(function(row) {
      translations[row.translation_id].features.all.push({
        name: row.hit_name,
        description: row.hit_description,
        db: row.db,
        interpro: row.interpro_ac,
        start: row.seq_start,
        end: row.seq_end
      });
    });
  }
}

var get_genes = {
  sql: 'select g.gene_id, g.stable_id, x.display_label as name, g.description, g.biotype,'
    + ' sr.name as region, g.seq_region_start as start, g.seq_region_end as end, g.seq_region_strand as strand,'
    + ' g.canonical_transcript_id,'
    + ' case when sra.value is not NULL then CAST(sra.value AS UNSIGNED) else 999999 end as karyotype'
    + ' from gene g'
    + ' inner join seq_region sr on g.seq_region_id = sr.seq_region_id'
    + ' left join seq_region_attrib sra on sra.seq_region_id = sr.seq_region_id and sra.attrib_type_id=367' // karyotype_rank
    + ' left join xref x on g.display_xref_id = x.xref_id'
    + ' where g.is_current=1'
    + ' order by karyotype asc, sr.length desc, g.seq_region_start asc',
  process: function(rows,meta,transcripts) {
    var all_genes = {};
    var gene_idx=0;
    rows.forEach(function(row) {
      var gene = {
        _id : row.stable_id,
        name: row.name ? row.name : row.stable_id,
        description: row.description,
        biotype: row.biotype,
        taxon_id: +meta['species.taxonomy_id'],
        system_name: meta['species.production_name'],
        db_type: db_type,
        gene_idx: gene_idx++,
        location: {
          region: row.region,
          start: row.start,
          end: row.end,
          strand: row.strand,
          map: meta['assembly.accession'],
        },
        xrefs: [],
        synonyms: [],
        gene_structure: {exons:[],transcripts:[]},
        annotations: {}
      };
      all_genes[row.gene_id] = gene;
      var c_trans = transcripts[row.canonical_transcript_id];
      if (c_trans) {
        gene.gene_structure.canonical_transcript = c_trans.stable_id
      }
    });
    return all_genes;
  }
}

// get xrefs and synonyms
var add_xrefs = {
  sql1: 'SELECT g.gene_id, x.dbprimary_acc, ed.db_name, es.synonym'
   + ' FROM gene g'
   + ' JOIN xref x ON x.xref_id = g.display_xref_id'
   + ' JOIN external_db ed ON ed.external_db_id = x.external_db_id'
   + ' LEFT JOIN external_synonym es ON es.xref_id = x.xref_id'
   + ' Where g.is_current=1',

  sql2: 'SELECT g.gene_id, x.dbprimary_acc, ed.db_name, es.synonym'
   + ' FROM gene g'
   + ' inner join transcript t on g.canonical_transcript_id = t.transcript_id'
   + ' JOIN xref x ON x.xref_id = t.display_xref_id'
   + ' JOIN external_db ed ON ed.external_db_id = x.external_db_id'
   + ' LEFT JOIN external_synonym es ON es.xref_id = x.xref_id'
   + ' Where g.is_current=1',

  sql3: 'SELECT g.gene_id, x.dbprimary_acc, ed.db_name, es.synonym'
   + ' FROM gene g'
   + ' inner join translation tl on g.`canonical_transcript_id` = tl.`transcript_id`'
   + ' inner join object_xref ox on tl.translation_id = ox.`ensembl_id`'
   + ' inner join xref x on ox.`xref_id` = x.xref_id'
   + ' inner join external_db ed on x.`external_db_id` = ed.`external_db_id`'
   + ' LEFT JOIN external_synonym es ON es.xref_id = x.xref_id'
   + ' WHERE g.`is_current`=1 and ox.`ensembl_object_type` = "Translation"',

  sql4: 'SELECT g.gene_id, x.dbprimary_acc, ed.db_name, es.synonym'
   + ' FROM gene g'
   + ' inner join object_xref ox on g.`canonical_transcript_id` = ox.`ensembl_id`'
   + ' inner join xref x on ox.`xref_id` = x.xref_id'
   + ' inner join external_db ed on x.`external_db_id` = ed.`external_db_id`'
   + ' LEFT JOIN external_synonym es ON es.xref_id = x.xref_id'
   + ' WHERE g.`is_current`=1 and ox.`ensembl_object_type` = "Transcript"',

  sql5: 'SELECT g.gene_id, x.dbprimary_acc, ed.db_name, es.synonym'
   + ' FROM gene g'
   + ' inner join object_xref ox on g.gene_id = ox.`ensembl_id`'
   + ' inner join xref x on ox.`xref_id` = x.xref_id'
   + ' inner join external_db ed on x.`external_db_id` = ed.`external_db_id`'
   + ' LEFT JOIN external_synonym es ON es.xref_id = x.xref_id'
   + ' WHERE g.`is_current`=1 and ox.`ensembl_object_type` = "Gene"',
  process: function(xrefs,geneInfo) {
    xrefs.forEach(function(xref) {
      geneInfo[xref.gene_id].xrefs.push({db: xref.db_name, id: xref.dbprimary_acc});
      if (xref.synonym) {
        geneInfo[xref.gene_id].synonyms.push(xref.synonym);
      }
    });
  }
}

function add_gene_structure(exons,transcripts,genes) {
  for(var transcript_id in transcripts) {
    var transcript = transcripts[transcript_id];
    var gene = genes[transcript.gene_id];
    // add transcript to gene 
    gene.gene_structure.transcripts.push(transcript);
    // add exons to gene
    transcript.exon_ids.forEach(function(exon_id) {
      var exon = exons[exon_id];
      gene.gene_structure.exons.push({
        id: exon.stable_id,
        start: gene.location.strand === 1 ?
          exon.seq_region_start - gene.location.start + 1 :
          gene.location.end - exon.seq_region_end + 1,
        end: gene.location.strand === 1 ?
          exon.seq_region_end - gene.location.start + 1 :
          gene.location.end - exon.seq_region_start + 1
      });
    });
    transcript.id = transcript.stable_id;
    delete transcript.stable_id;
    delete transcript.exon_ids;
    delete transcript.transcript_id;
    delete transcript.gene_id;
  }
}

// ugly nested way to do each step in a predictable sequence
/*
  get_metadata
  get_exons
  get_transcripts
  add_exons_to_transcripts
  add_translations_to_transcripts
  add_features_to_translations
  get_genes
  add_xrefs
*/


connection.query(get_metadata.sql, function(err, rows, fields) {
  if (err) throw err;
  var meta = get_metadata.process(rows);

  connection.query(get_exons.sql, function(err, rows, fields) {
    if (err) throw err;
    var exons = get_exons.process(rows);

    connection.query(get_transcripts.sql, function(err, rows, fields) {
      if (err) throw err;
      var transcripts = get_transcripts.process(rows);

      connection.query(add_exons_to_transcripts.sql, function(err, rows, fields) {
        if (err) throw err;
        add_exons_to_transcripts.process(rows, exons, transcripts);

        connection.query(add_translations_to_transcripts.sql, function(err, rows, fields) {
          if (err) throw err;
          var translations = add_translations_to_transcripts.process(rows, exons, transcripts);

          connection.query(add_features_to_translations.sql, function(err, rows, fields) {
            if (err) throw err;
            add_features_to_translations.process(rows, translations);

            connection.query(get_genes.sql, function(err, rows, fields) {
              if (err) throw err;
              var genes = get_genes.process(rows, meta, transcripts);

              connection.query(add_xrefs.sql1, function(err, rows, fields) {
                if (err) throw err;
                add_xrefs.process(rows, genes);

                connection.query(add_xrefs.sql2, function(err, rows, fields) {
                  if (err) throw err;
                  add_xrefs.process(rows, genes);

                  connection.query(add_xrefs.sql3, function(err, rows, fields) {
                    if (err) throw err;
                    add_xrefs.process(rows, genes);

                    connection.query(add_xrefs.sql4, function(err, rows, fields) {
                      if (err) throw err;
                      add_xrefs.process(rows, genes);

                      connection.query(add_xrefs.sql5, function(err, rows, fields) {
                        if (err) throw err;
                        add_xrefs.process(rows, genes);

                        add_gene_structure(exons,transcripts,genes);

                        for(var gene_id in genes) {
                          var gene = genes[gene_id];
                          // uniqify xrefs (group by db_name)
                          if (gene.xrefs.length > 0) {
                            gene.xrefs = _.map(_.groupBy(gene.xrefs, 'db'),function(xrefs,db) {
                              return {db:db, ids: _.uniqBy(xrefs,'id').map(function(xref) {return xref.id;})}
                            });
                          }
                          // uniqify synonyms
                          if (gene.synonyms.length > 0) {
                            gene.synonyms = _.uniq(gene.synonyms)
                          }
                          else {
                            delete gene.synonyms;
                          }
                          // uniqify exons
                          gene.gene_structure.exons = _.uniqBy(gene.gene_structure.exons,'id');
                          console.log(JSON.stringify(gene));
                        }
                        connection.end();

                      }); // add_xrefs 5
                    }); // add_xrefs 4
                  }); // add_xrefs 3
                }); // add_xrefs 2
              }); // add_xrefs 1
            }); // get_genes
          }); // add_features_to_translations
        }); // add_translations_to_transcripts
      }); // add_exons_to_transcripts
    }); // get_transcripts
  }); // get_exons
}); // get_metadata


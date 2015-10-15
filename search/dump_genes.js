#!/usr/bin/env node
var argv = require('minimist')(process.argv.slice(2));

// connect to mysql database
var mysql = require('mysql');
var connection = mysql.createConnection({
  host: argv.h,
  user: argv.u,
  password: argv.p,
  database: argv.d
});
if (!connection) throw "error";
connection.connect();

// lookup metadata
var metadata = {
  sql: 'select meta_key,meta_value from meta',
  process: function(rows) {
    var meta = {};
    rows.forEach(function(row) {
      meta[row.meta_key] = row.meta_value;
    });
    return meta
  }
};
// lookup exons in canonical transcripts
var exons = {
  sql: 'select g.canonical_transcript_id, t.stable_id, e.exon_id,'
   + ' e.seq_region_start - g.seq_region_start + 1 as start,'
   + ' e.seq_region_end - g.seq_region_start + 1 as end,'
   + ' et.rank'
   + ' from gene g'
   + ' inner join transcript t on g.canonical_transcript_id = t.transcript_id'
   + ' inner join exon_transcript et on g.canonical_transcript_id = et.transcript_id'
   + ' inner join exon e on e.exon_id = et.exon_id'
   + ' where g.is_current=1'
   + ' and e.seq_region_start >= g.seq_region_start' // sanity check
   + ' and e.seq_region_end >= g.seq_region_start'   // that the gene
   + ' and e.seq_region_id = g.seq_region_id'       // contains the exon
   + ' order by et.transcript_id, et.rank',
  process: function(exons) {
    var can_trans = {};
    exons.forEach(function(exon) {
      if (!can_trans.hasOwnProperty(exon.canonical_transcript_id)) {
        can_trans[exon.canonical_transcript_id] = {
          name: exon.stable_id, // this is actuall the transcript's stable_id, sorry.
          length: 0,
          exons: [],
          exonJunctions: []
        };
      }
      else { // not the first exon
        can_trans[exon.canonical_transcript_id].exonJunctions.push(
          can_trans[exon.canonical_transcript_id].length);
      }
      can_trans[exon.canonical_transcript_id].length += exon.end - exon.start + 1;
      can_trans[exon.canonical_transcript_id].exons.push(
        { start: exon.start, end: exon.end, id: exon.exon_id }
      );
    });
    return can_trans;
  }
}
// lookup gene info and the canonical translation
var genes = {
  sql: 'select g.gene_id, g.stable_id, x.display_label as name, g.description, g.biotype,'
    + ' sr.name as region, g.seq_region_start as start, g.seq_region_end as end, g.seq_region_strand as strand,'
    + ' g.canonical_transcript_id, tl.stable_id as translation_stable_id,'
    + ' ta164.value as IsoPoint,'
    + ' ta165.value as Charge,'
    + ' ta166.value as MolecularWeight,'
    + ' ta167.value as NumResidues,'
    + ' ta168.value as AvgResWeight,'
    + ' tl.seq_start, tl.start_exon_id, tl.seq_end, tl.end_exon_id'
    + ' from gene g'
    + ' inner join seq_region sr on g.seq_region_id = sr.seq_region_id'
    + ' LEFT join translation tl on g.canonical_transcript_id = tl.transcript_id'
    + ' left join xref x on g.display_xref_id = x.xref_id'
    + ' left join translation_attrib ta164 on tl.translation_id = ta164.translation_id and ta164.attrib_type_id = 164'
    + ' left join translation_attrib ta165 on tl.translation_id = ta165.translation_id and ta165.attrib_type_id = 165'
    + ' left join translation_attrib ta166 on tl.translation_id = ta166.translation_id and ta166.attrib_type_id = 166'
    + ' left join translation_attrib ta167 on tl.translation_id = ta167.translation_id and ta167.attrib_type_id = 167'
    + ' left join translation_attrib ta168 on tl.translation_id = ta168.translation_id and ta168.attrib_type_id = 168'
    + ' where g.is_current=1;',
  process: function(genes,meta,transcripts) {
    gene = {};
    genes.forEach(function(row) {
      var c_trans = transcripts[row.canonical_transcript_id];
      gene[row.gene_id] = {
        _id : row.stable_id,
        name: row.name ? row.name : row.stable_id,
        description: row.description,
        biotype: row.biotype,
        taxon_id: +meta['species.taxonomy_id'],
        system_name: meta['species.production_name'],
        schema_type: meta['schema_type'],
        location: {
          region: row.region,
          start: row.start,
          end: row.end,
          strand: row.strand,
          map: meta['assembly.accession']
        },
        xrefs: {},
        synonyms: {},
        canonical_transcript: c_trans
      };
      if (row.translation_stable_id) {
        gene[row.gene_id].canonical_translation = {
          name: row.translation_stable_id,
          length: +row.NumResidues,
          molecularWeight: +row.MolecularWeight,
          avgResWeight: +row.AvgResWeight,
          charge: +row.Charge,
          isoPoint: +row.IsoPoint, 
          features: {
            all: []
          }
        };
        // add the CDS start and end to the canonical transcript
        c_trans.CDS = {start:0, end:0};
        var pos=0;
        c_trans.exons.forEach(function(exon) {
          if (c_trans.CDS.start === 0 && exon.id === row.start_exon_id) {
            c_trans.CDS.start = pos + row.seq_start;
          }
          if (c_trans.CDS.end === 0 && exon.id === row.end_exon_id) {
            c_trans.CDS.end = pos + row.seq_end;
          }
          pos += exon.end - exon.start + 1;
        });
      }
      if (c_trans && c_trans.hasOwnProperty('exons')) {
        c_trans.exons.forEach(function(exon) {
          delete exon.id; // don't need id any more
        });
      }
    });
    return gene;
  }
}
// get xrefs
var xrefs = {
  sql: 'SELECT g.gene_id, x.dbprimary_acc, ed.db_name, es.synonym'
   + ' FROM gene g'
   + ' JOIN xref x ON x.xref_id = g.display_xref_id'
   + ' JOIN external_db ed ON ed.external_db_id = x.external_db_id'
   + ' LEFT JOIN external_synonym es ON es.xref_id = x.xref_id'
   + ' Where g.is_current=1'
   + ' union'
   + ' SELECT g.gene_id, x.dbprimary_acc, ed.db_name, es.synonym'
   + ' FROM gene g'
   + ' inner join transcript t on g.canonical_transcript_id = t.transcript_id'
   + ' JOIN xref x ON x.xref_id = t.display_xref_id'
   + ' JOIN external_db ed ON ed.external_db_id = x.external_db_id'
   + ' LEFT JOIN external_synonym es ON es.xref_id = x.xref_id'
   + ' Where g.is_current=1'
   + ' union'
   + ' SELECT g.gene_id, x.dbprimary_acc, ed.db_name, es.synonym'
   + ' FROM gene g'
   + ' inner join translation tl on g.`canonical_transcript_id` = tl.`transcript_id`'
   + ' inner join object_xref ox on tl.translation_id = ox.`ensembl_id`'
   + ' inner join xref x on ox.`xref_id` = x.xref_id'
   + ' inner join external_db ed on x.`external_db_id` = ed.`external_db_id`'
   + ' LEFT JOIN external_synonym es ON es.xref_id = x.xref_id'
   + ' WHERE g.`is_current`=1 and ox.`ensembl_object_type` = "Translation"'
   + ' union'
   + ' SELECT g.gene_id, x.dbprimary_acc, ed.db_name, es.synonym'
   + ' FROM gene g'
   + ' inner join object_xref ox on g.`canonical_transcript_id` = ox.`ensembl_id`'
   + ' inner join xref x on ox.`xref_id` = x.xref_id'
   + ' inner join external_db ed on x.`external_db_id` = ed.`external_db_id`'
   + ' LEFT JOIN external_synonym es ON es.xref_id = x.xref_id'
   + ' WHERE g.`is_current`=1 and ox.`ensembl_object_type` = "Transcript"'
   + ' union'
   + ' SELECT g.gene_id, x.dbprimary_acc, ed.db_name, es.synonym'
   + ' FROM gene g'
   + ' inner join object_xref ox on g.gene_id = ox.`ensembl_id`'
   + ' inner join xref x on ox.`xref_id` = x.xref_id'
   + ' inner join external_db ed on x.`external_db_id` = ed.`external_db_id`'
   + ' LEFT JOIN external_synonym es ON es.xref_id = x.xref_id'
   + ' WHERE g.`is_current`=1 and ox.`ensembl_object_type` = "Gene"',
  add2Genes: function(xrefs,geneInfo) {
    xrefs.forEach(function(xref) {
      var gx = geneInfo[xref.gene_id].xrefs
      if (! gx.hasOwnProperty(xref.db_name)) {
        gx[xref.db_name] = {};
      }
      gx[xref.db_name][xref.dbprimary_acc] = 1;
      if (xref.synonym) {
        geneInfo[xref.gene_id].synonyms[xref.synonym] = 1;
      }
    });
  }
}
// get interpro protein features
var features = {
  sql: 'SELECT g.gene_id, ipr.interpro_ac, pf.seq_start, pf.seq_end, pf.hit_name, pf.hit_description'
   + ' FROM gene g'
   + ' inner join transcript t on g.canonical_transcript_id = t.transcript_id'
   + ' inner join translation tl on t.transcript_id = tl.transcript_id'
   + ' inner join protein_feature pf on tl.translation_id = pf.translation_id'
   + ' inner join interpro ipr on pf.hit_name = ipr.id'
   + ' WHERE g.is_current = 1',
  add2Genes: function(features, geneInfo) {
    features.forEach(function(feature) {
      geneInfo[feature.gene_id].canonical_translation.features.all.push({
        name: feature.hit_name,
        description: feature.hit_description,
        interpro: feature.interpro_ac,
        start: feature.seq_start,
        end: feature.seq_end
      });
    });
  }
}
// ugly nested way to do each step in a predictable sequence
connection.query(metadata.sql, function(err, rows, fields) {
  if (err) throw err;
  var meta = metadata.process(rows);
  connection.query(exons.sql, function(err, rows, fields) {
    if (err) throw err;
    var transcripts = exons.process(rows);
    connection.query(genes.sql, function(err, rows, fields) {
      if (err) throw err;
      var geneInfo = genes.process(rows,meta,transcripts);
      connection.query(xrefs.sql, function(err, rows, fields) {
        if (err) throw err;
        xrefs.add2Genes(rows,geneInfo);
        connection.query(features.sql, function(err, rows, fields) {
          if (err) throw err;
          features.add2Genes(rows,geneInfo);
          for(var gene in geneInfo) {
            Object.keys(geneInfo[gene].xrefs).forEach(function(xref_key) {
              var uniq_list = Object.keys(geneInfo[gene].xrefs[xref_key]);
              geneInfo[gene].xrefs[xref_key] = uniq_list;
            });
            var syn_list = Object.keys(geneInfo[gene].synonyms);
            if (syn_list.length > 0) {
              geneInfo[gene].synonyms = syn_list;
            }
            else {
              delete geneInfo[gene].synonyms;
            }
            console.log(JSON.stringify(geneInfo[gene]));
          }
          connection.end();
        });
      });
    });
  });
});

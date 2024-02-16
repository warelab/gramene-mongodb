#!/usr/bin/env node
const collections = require('gramene-mongodb-config');
const annotTypes = ['GO','PO','TO','pathways','domains'];

collections.maps.mongoCollection().then(function(mapsColl) {
  // make a lookup table for species name
  console.error('fetch species name lookup table');
  mapsColl.find().toArray(function(err,maps) {
    if (err) throw err;
    let speciesLUT = {};
    maps.forEach(m => {
      speciesLUT[m.system_name] = m.display_name;
    });
    // iterate over the genes
    console.error('start iterating over the genes');
    collections.genes.mongoCollection().then(function(genesColl) {
      var cursor = genesColl.find({},{sort:{'species_idx':1,'db_type':1,'gene_idx':1}});
      cursor.each(function(err,mongo) {
        if (err) throw err;
        if (mongo == null) {
          console.error('finished');
          collections.closeMongoDatabase();
        }
        else {
          // create a gramene record
          let gramene = [
            mongo._id,
            "Gene",
            "Gramene",
            "Gramene Plants",
            `https://gramene.org?idList=${mongo._id}`,
            speciesLUT[mongo.system_name]
          ];
          // and an ensembl plants record
          let eg = [
            mongo._id,
            "Gene",
            "EBI",
            "Ensembl Plants",
            `https://plants.ensembl.org/${mongo.system_name}/Gene/Summary?g=${mongo._id}`,
            speciesLUT[mongo.system_name]
          ];
          // the last column is a semi-colon (;) delimited list of descriptors
          let descriptors = [];
          if (mongo.name && mongo.name !== mongo._id) { // non-trivial gene name
            descriptors.push(mongo.name);
          }
          if (mongo.synonyms) { // list of synonyms in parentheses (abc1, abc_1, etc)
            descriptors.push(`(${mongo.synonyms.join(', ')})`)
          }
          let need_more = true;
          if (mongo.description && mongo.description !== "unknown" && /\w/.test(mongo.description)) { // non-trivial gene description
            descriptors.push(mongo.description);
            need_more = false;
          }
          descriptors.push(mongo.biotype.replace('_',' ') + ' gene'); // protein_coding => protein coding gene
          if (mongo.summary && mongo.summary !== "NULL") { // this is good
            descriptors.push(mongo.summary);
          }
          if (need_more && mongo.homology && mongo.homology.gene_tree.representative) { // There is a well annotated homolog
            if (mongo.homology.gene_tree.representative.closest) {
              const rep = mongo.homology.gene_tree.representative.closest;
              if (rep.description) {
                descriptors.push(`Similar to ${rep.id} ${rep.name !== rep.id && rep.name} ${rep.description}`);
              }
            }
          }
          annotTypes.forEach(ann => { // gather other annotated terms
            if (mongo.annotations[ann] && mongo.annotations[ann].entries) {
              mongo.annotations[ann].entries.forEach(e => {
                descriptors.push(`${e.id} ${e.name}`);
              })
            }
          })
          const description = descriptors.join('; ');
          gramene.push(description);
          eg.push(description);
          console.log(gramene.join("\t"));
          console.log(eg.join("\t"));
        }
      })
    })
  })
})

select
g1.stable_id as ':START_ID(Gene)',
g2.stable_id as ':END_ID(Gene)',
h.description as kind,
h.homology_id as 'homologyId:long',
h.is_tree_compliant as 'isTreeCompliant:boolean'

from homology h
inner join homology_member hm on hm.homology_id = h.homology_id
inner join gene_member g1 on hm.gene_member_id = g1.gene_member_id
inner join homology_member hm2 on hm2.homology_id = h.homology_id and hm.gene_member_id > hm2.gene_member_id
inner join gene_member g2 on hm2.gene_member_id = g2.gene_member_id

-- where g1.gene_member_id < 100000 and g2.gene_member_id < 100000
;
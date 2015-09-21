select
g1.stable_id as 'geneId',
g2.stable_id as 'otherId',
h.description as kind,
h.is_tree_compliant as 'isTreeCompliant'

from homology h
inner join homology_member hm on hm.homology_id = h.homology_id
inner join gene_member g1 on hm.gene_member_id = g1.gene_member_id
inner join homology_member hm2 on hm2.homology_id = h.homology_id and hm.gene_member_id > hm2.gene_member_id
inner join gene_member g2 on hm2.gene_member_id = g2.gene_member_id

-- where g1.gene_member_id < 100000 and g2.gene_member_id < 100000
;

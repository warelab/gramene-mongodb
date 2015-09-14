select g1.stable_id as gene_a, g2.stable_id as gene_b, h.description, h.homology_id, h.is_tree_compliant, h.gene_tree_node_id

from homology h
inner join homology_member hm on hm.homology_id = h.homology_id
inner join gene_member g1 on hm.gene_member_id = g1.gene_member_id
inner join homology_member hm2 on hm2.homology_id = h.homology_id and hm.gene_member_id > hm2.gene_member_id
inner join gene_member g2 on hm2.gene_member_id = g2.gene_member_id;

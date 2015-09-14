select 'Gene;TreeNode' as ':LABEL', gene.stable_id as 'name:ID(Gene)', gene.display_label as 'displayLabel'
from gene_member gene
where gene.gene_trees >= 1
-- and gene.gene_member_id < 100000
;

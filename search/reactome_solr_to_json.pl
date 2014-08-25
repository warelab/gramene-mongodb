#!/usr/bin/env perl
use strict;
use warnings;
use autodie;

my $head = <>;
while (<>) {
	chomp;
	my ($id, $title, $module, $object, $species, $taxonomy, $content) = split /\t/, $_;
    my ($obj_id, $pathway_id, $species_id) = $id =~ m/(\d+)-(\d+)-(\d+)$/;
    print qq {{"object_id":$obj_id,"pathway_id":$pathway_id,"species_id":$species_id,"title":"$title","taxon_id":$taxonomy,"system_name":"$species","content":"$content"}
};
}
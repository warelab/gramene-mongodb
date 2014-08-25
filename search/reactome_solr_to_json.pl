#!/usr/bin/env perl
use strict;
use warnings;
use autodie;

my $head = <>;
while (<>) {
	chomp;
	my ($id, $title, $module, $object, $system_name, $taxonomy, $content) = split /\t/, $_;
    my ($obj_id, $pathway_id, $species_id) = $id =~ m/(\d+)-(\d+)-(\d+)$/;
    my ($genus, $species, $type, $name) = $title =~ m/(\S+)\s+(\S+)\s(\S+)\s+(.+)/;
    my $pathway;
    if ($type eq 'pathway') {
        $pathway = $name;
    }
    else {
        ($name, $pathway) = $name =~ m/(.+?)\s*\(pathway:\s+(.+)\)/;
    }
    # $content =~ s/${name}\s*//;
    $content = substr $content, length($name)+1;
    my $class;
    ($class,$content) = $content =~ m/(\S+)\s*(.*)/;
    print qq{"object_id":$obj_id,"pathway_id":$pathway_id,"species_id":$species_id,"taxon_id":$taxonomy};
    print qq{,"type":"$type","system_name":"$system_name","name":"$name","pathway":"$pathway"};
    if ($content) {
        if ($class eq "Reaction" or $class eq "Pathway") {
            my $location;
            ($location,$content) = $content =~ m/(cytosol|cytoplasm|nucleoplasm|plastid stroma|mitochondrial matrix|endoplasmic reticulum membrane|plasma membrane)\s*(\s*)/;
            print qq{,"location":"$location"} if $location;
        }
    }
    print qq{,"content":"$content"} if $content;
    print qq{,"class":"$class"\n};
}
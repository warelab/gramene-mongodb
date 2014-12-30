#!/usr/bin/env perl
use strict;
use warnings;
use autodie;
my $geneList = shift @ARGV;
my %genes;
open (my $gfh, "<", $geneList);
while (<$gfh>) {
  chomp;
  $genes{$_} = 1;
}
close $gfh;

my %docs;
my %p2type;
my %speciesInfo;
while (<>) {
	chomp;
	my ($id, $title, $module, $object, $system_name, $taxonomy, $content) = split /\t/, $_;
  next if $system_name eq 'homo_sapiens' or $id eq 'id';
  my ($obj_id, $pathway_id, $species_id) = $id =~ m/(\d+)-(\d+)-(\d+)$/;
  my ($species, $type, $name) = $title =~ m/(\S+)\s+(pathway|catalyst|reaction|reactant)\s+(.+)/;
  if (not exists $speciesInfo{$species_id}) {
    $speciesInfo{$species_id} = 1;
    $taxonomy = 0 unless $taxonomy =~ m/^\d+$/;
    print "{\"_id\":$species_id,\"biotype\":\"species\",\"taxon_id\":$taxonomy,\"system_name\":\"$system_name\"}\n";
  }
  my $pathway;
  if ($type eq 'pathway') {
    $pathway = $name;
  }
  else {
    ($name, $pathway) = $name =~ m/(.+?)\s*\(pathway:\s+(.+)\)/;
    exists $p2type{$pathway_id}or $p2type{$pathway_id} = {};
    exists $p2type{$pathway_id}{$type} or $p2type{$pathway_id}{$type} = [];
    push @{$p2type{$pathway_id}{$type}}, $obj_id;
  }
  
  if (not exists $docs{$obj_id}) {
    $docs{$obj_id} = {
      biotype => $type,
      name    => $name
    };
  }

  $docs{$obj_id}{pathways}{$pathway_id}=1;
  $docs{$obj_id}{species}{$species_id}=1;
  
  $content = substr $content, length($name)+1;
  my $class;
  ($class,$content) = $content =~ m/(\S+)\s*(.*)/;
  if ($content) {
    if ($class eq "Reaction" or $class eq "Pathway") {
      my $location;
      ($location,$content) = $content =~ m/(cytosol|cytoplasm|nucleoplasm|plastid stroma|mitochondrial matrix|endoplasmic reticulum membrane|plasma membrane)\s*(.*)/;
      $docs{$obj_id}{locations}{$location}=1 if $location;
      if ($content) {
        my $GO;
        ($GO,$content) = $content =~ m/.*GO:(\d+)\s*(.*)/;
        $docs{$obj_id}{GOs}{$GO+0}=1 if $GO;
        # at this point content is just a list of gene ids (if any)
        if ($content) {
          for my $gene (split /\s+/, $content) {
            $docs{$obj_id}{genes}{$gene}=1 if (exists $genes{$gene});
          }
        }
      }
    }
  }
}


while (my ($id,$fields) = each %docs) {
  print "{\"_id\":$id";
  if (exists $p2type{$id}) {
    for my $m (keys %{$p2type{$id}}) {
      print ",\"$m\":[",join(',',@{$p2type{$id}{$m}}),"]";
    }
  }
  for my $f (keys %$fields) {
    if (ref($fields->{$f}) eq 'HASH') {
      my @v = keys %{$fields->{$f}};
      if ($v[0] =~ m/^\d+$/) {
        print ",\"$f\":[",join(',',@v),"]";
      }
      else {
        print ",\"$f\":[\"",join('","',@v),"\"]";
      }
    }
    else {
      print ",\"$f\":\"$fields->{$f}\"";
    }
  }
  print "}\n";
}

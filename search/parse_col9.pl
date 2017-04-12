#!/usr/bin/env perl
use strict;
use warnings;
use autodie;
use JSON;

my %geneAttributes;
while (<>) {
  chomp;
  my %attrib;
  for my $kv (split /;/, $_) {
    my ($k,$v) = $kv =~ m/(\w+)=(.+)/;
    $attrib{$k} = $v;
  }
  my %ga;
  $ga{name} = $attrib{symbol} || $attrib{Name};
  $ga{description} = $attrib{full_name} || $attrib{Note} || $attrib{description} || $attrib{computational_description};
  $ga{summary} = $attrib{curator_summary} if ($attrib{curator_summary});
  if ($attrib{Alias}) {
    my @syn = split /,/, $attrib{Alias};
    $ga{synonyms} = \@syn;
  }
  $geneAttributes{$attrib{ID}} = \%ga;  
}


print encode_json \%geneAttributes;
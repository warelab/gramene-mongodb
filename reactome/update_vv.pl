#!/usr/bin/env perl
use strict;
use warnings;
use autodie;

open (my $fh, "<", "vv_orthologs.v3.v4.txt");
my %lut;
while (<$fh>) {
    chomp;
    my ($v3,$v4) = split /\t/, $_;
    $lut{$v4} = $v3;
}
close $fh;

while (<>) {
    if (my ($id) = $_=~ m/^\s\s"(\S+)":\s\{$/) {
        if ($lut{$id}) {
            print "  \"$lut{$id}\": {\n";
        }
        else {
            print $_;
        }
    }
    else {
        print $_;
    }
}
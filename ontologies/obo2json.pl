#!/usr/bin/env perl
use strict;
use warnings;
use autodie;
use JSON;
use Readonly;

Readonly my %MULTI = map { $_ , 1 } qw(
    alt_id
    consider
    disjoint_from
    expand_assertion_to
    intersection_of
    is_a
    relationship
    remark
    replaced_by
    subset
    subsetdef
    synonymtypedef
    synonym
    xref
);

my $prefix = shift @ARGV;
my $outDir = shift @ARGV;
$outDir ||= '.';
$outDir =~ s/\/+$//;

my %hsh;
my $key="Global";
open (my $fh, ">", "$outDir/$prefix.$key.json");
my %parent;
my %ontology;
while (<>) {
    if (/^\[(\S+)\]$/) { # new [Term] [Typedef], [etc.]
        %hsh=();
        if ($key ne $1) {
            close $fh;
            $key = $1;
            open($fh, ">", "$outDir/$prefix.$key.json");
        }
    }
    elsif (my($k,$v) = /^(\S+):\s*(.+)$/) { # parse key-value pair
        $v =~ s/^"(.+)".*/$1/; # strip off quotes and qualifiers(?)
        my $v_str = $v;
        if ($v =~ m/^${prefix}:0*(\d+)/) {
            if ($k eq 'id') {
              $hsh{_orig_id_} = $v;
            }
            $v = $1+0;
            if ($k eq 'alt_id') {
              $v = $v_str;
            }
        }
        if ($MULTI{$k}) {
            push @{$hsh{$k}}, $v;
        }
        else {
            $hsh{$k} = $v;
            if($k eq "is_obsolete") {
                $hsh{$k} = ($v eq "true");
            }
        }
    }
    else { # reached the end of a stanza
        if (exists $hsh{id}) {
          # generate parent-child relationships from is_a and part_of relationships
            if (exists $hsh{is_a}) {
                for (my $i=0;$i<@{$hsh{is_a}};$i++) {
                    $parent{$hsh{id}}{$hsh{is_a}[$i]}=1;
                }
            }
            if (exists $hsh{relationship}) {
              for (my $i=0;$i<@{$hsh{relationship}};$i++) {
                if ($hsh{relationship}[$i] =~ m/part_of\s+${prefix}:0*(\d+)/) {
                  $parent{$hsh{id}}{$1} = 1;
                }
              }
            }
            # use the id field as the mongo _id
            $hsh{_id} = $hsh{id};
            $hsh{id} = $hsh{_orig_id_};
            delete $hsh{_orig_id_};
            # save a copy for later
            %{$ontology{$key}{$hsh{_id}}} = %hsh;
        }
        else {
            # write one json object
            print $fh encode_json \%hsh, "\n";
        }
    }
}
close $fh;

for my $okey (keys %ontology) {
    open($fh, ">", "$outDir/$prefix.$okey.json");
    while (my ($k,$v) = each %{$ontology{$okey}}) {
        if ($okey eq "Term") {
            # populate ancestors
            my @S = ($k);
            my %p;
            while (@S) {
                my $t = pop @S;
                if ($t =~ m/^\d+$/) {
                    $p{$t}=1;
                    push @S, keys %{$parent{$t}} if ($parent{$t});
                }
            }
            delete $p{$okey};
            my @a = sort {$a <=> $b} map {$_+0} keys %p;
            $v->{ancestors} = \@a;
        }
        if ($v->{_id} =~ m/^\d+$/) {
            $v->{_id} += 0;
        }
        if ($v->{is_a}) {
            my @a = sort {$a <=> $b} map {$_+0} @{$v->{is_a}};
            $v->{is_a} = \@a;
        }
        print $fh encode_json($v), "\n";
    }
    close $fh;
}


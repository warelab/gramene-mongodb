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

my %hsh;
my $key="Global";
open (my $fh, ">", "$prefix.$key.json");
my %parent;
my %ontology;
while (<>) {
    if (/^\[(\S+)\]$/) { # new [Term] [Typedef], [etc.]
        %hsh=();
        if ($key ne $1) {
            close $fh;
            $key = $1;
            open($fh, ">", "$prefix.$key.json");
        }
    }
    elsif (my($k,$v) = /^(\S+):\s*(.+)$/) { # parse key-value pair
        $v =~ s/^"(.+)".*/$1/; # strip off quotes and qualifiers(?)
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
            # clean up the is_a entries  
            if (exists $hsh{is_a}) {
                for (my $i=0;$i<@{$hsh{is_a}};$i++) {
                    $hsh{is_a}[$i] =~ s/\s!\s.*//;
                    $parent{$hsh{id}}{$hsh{is_a}[$i]}=1;
                }
            }
            # use the id field as the mongo _id
            $hsh{_id} = $hsh{id};
            # delete $hsh{id};
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
    open($fh, ">", "$prefix.$okey.json");
    while (my ($k,$v) = each %{$ontology{$okey}}) {
        if ($okey eq "Term") {
            if (exists $v->{_id} and $v->{_id} =~ m/^\S+:0*(\d+)$/) {
                $v->{_id} = $1 + 0;
            }

            # populate ancestors
            my @S = ($k);
            my %p;
            while (@S) {
                my $t = pop @S;
                if ($t =~ m/^\S+:0*(\d+)$/) {
                    $p{$1}=1;
                    push @S, keys %{$parent{$t}} if ($parent{$t});
                }
            }
            delete $p{$okey};
            my @a = sort {$a <=> $b} map { s/^\S+:0*//; $_ + 0 } keys %p;
            $v->{ancestors} = \@a;
        }
        print $fh encode_json($v), "\n";
    }
    close $fh;
}


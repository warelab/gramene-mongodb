#!/usr/bin/env perl
use strict;
use warnings;
use autodie;
my %LUT = (
    "aracyc.tab.gz"     => [ 3702,  'Arabidopsis thaliana',    'ARA' ],
    "brachycyc.tab.gz"  => [ 15368, 'Brachypodium distachyon', 'BRACHY' ],
    "lycocyc.tab.gz"    => [ 4081,  'Solanum lycopersicum',    'LYCO' ],
    "maizecyc.tab.gz"   => [ 4577,  'Zea mays',                'MAIZE' ],
    "poplarcyc.tab.gz"  => [ 3694,  'Populus trichocarpa',     'POPLAR' ],
    "potatocyc.tab.gz"  => [ 4113,  'Solanum tuberosum',       'POTATO' ],
    "ricecyc.tab.gz"    => [ 39947, 'Oryza sativa japonica',   'RICE' ],
    "sorghumcyc.tab.gz" => [ 4558,  'Sorghum bicolor',         'SORGHUM' ]
);
my $path = shift @ARGV;

for my $fname (keys %LUT) {
    my ($taxon_id, $species, $system_name) = @{$LUT{$fname}};
    open (my $fh, "gzip -cd $path/$fname |");
    my $head = <$fh>;
    chomp $head;
    my @fields = split /\t/, $head;
    while (<$fh>) {
        chomp;
        my @c = split /\t/, $_;
        my @fv = (
            "\"taxon_id\":$taxon_id",
            "\"species\":\"$species\"",
            "\"system_name\":\"$system_name\""
        );
        for (my $i=0;$i<@fields;$i++) {
            if ($fields[$i] eq 'ec') {
                $c[$i] =~ s/ec-//i;
            }
            push @fv, "\"$fields[$i]\":\"$c[$i]\"";
        }
        print "{",join(",",@fv),"}\n";
    }
}

#!/usr/bin/env perl
use lib '.';
use PostData;

my %lut = {};
my %count = 0;
while(<>) {
    next if $_ =~ /:START_ID/;

    ++$count;
    my @fields = split;
    my ($geneId1, $geneId2, $kind, undef, $isGood) = @fields;

    my %homolog1 = ('otherId' => $geneId2, 'kind' => $kind, 'isTreeCompliant' => $isGood);
    my %homolog2 = ('otherId' => $geneId1, 'kind' => $kind, 'isTreeCompliant' => $isGood);

    push @{ $lut{$geneId1} }, \%homolog1;
    push @{ $lut{$geneId2} }, \%homolog2;

    print $count . "\n" if $count % 10000 == 0;
#    PostData(\%lut);

}
// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/// Gas benchmarks, read with `sui move test -s`: each test runs one workload at
/// a scale where differences between implementations show up.
module matchmaker::bench_tests;

use matchmaker::matchmaker::{Self, Matchmaker};
use std::unit_test::{assert_eq, destroy};
use sui::{address, clock::{Self, Clock}, random::{Self, RandomGenerator}};

/// Type identifying the benchmarked queue.
public struct BENCH()

/// Tickets per bucket; below the default capacity, so nothing is evicted.
const PER_BUCKET: u64 = 30;
/// Default ticket lifetime.
const TTL_MS: u64 = 600_000;

fun setup(): (Matchmaker<BENCH>, Clock, RandomGenerator) {
    let ctx = &mut tx_context::dummy();
    let mm = matchmaker::new(internal::permit<BENCH>(), matchmaker::default_config(), ctx);
    let rng = random::new_generator_from_seed_for_testing(b"bench");
    (mm, clock::create_for_testing(ctx), rng)
}

fun player(n: u64): address { address::from_u256(n as u256) }

/// `find_game` as player number `n`; returns whether they were paired.
fun find(
    mm: &mut Matchmaker<BENCH>,
    rng: &mut RandomGenerator,
    clock: &Clock,
    n: u64,
    rating: u64,
    window: u64,
): bool {
    let ctx = &mut tx_context::new_from_hint(player(n), n, 0, 0, 0);
    let permit = internal::permit<BENCH>();
    let (_, found) = matchmaker::find_game(permit, mm, rng, clock, rating, window, ctx);
    found.is_some()
}

/// Queue `PER_BUCKET` zero-window tickets with distinct ratings into every
/// bucket in `[first, last]`; none is compatible with another. Player numbers
/// are the ratings.
fun fill(
    mm: &mut Matchmaker<BENCH>,
    rng: &mut RandomGenerator,
    clock: &Clock,
    first: u64,
    last: u64,
) {
    first.range_do_eq!(last, |bucket| PER_BUCKET.do!(|i| {
        let rating = bucket * 100 + i;
        assert!(!find(mm, rng, clock, rating, rating, 0));
    }));
}

#[test]
/// 300 players queue while every bucket in reach is occupied: each call scans
/// all of them without finding a match.
fun bench_queue_without_match() {
    let (mut mm, clock, mut rng) = setup();
    fill(&mut mm, &mut rng, &clock, 10, 19);
    assert_eq!(mm.queue_length(), 10 * PER_BUCKET);

    destroy(mm);
    clock.destroy_for_testing();
}

#[test]
/// 150 players each draw an opponent out of crowded buckets until the queue is
/// empty.
fun bench_match_from_crowded_buckets() {
    let (mut mm, clock, mut rng) = setup();
    fill(&mut mm, &mut rng, &clock, 13, 17);

    (5 * PER_BUCKET).do!(|i| assert!(find(&mut mm, &mut rng, &clock, 10_000 + i, 1550, 350)));
    assert_eq!(mm.queue_length(), 0);

    destroy(mm);
    clock.destroy_for_testing();
}

#[test]
/// One call walks every ring and prunes 300 expired tickets.
fun bench_prune_expired() {
    let (mut mm, mut clock, mut rng) = setup();
    fill(&mut mm, &mut rng, &clock, 10, 19);

    clock.set_for_testing(TTL_MS + 1);
    assert!(!find(&mut mm, &mut rng, &clock, 10_000, 1500, 0));
    assert_eq!(mm.queue_length(), 1);

    destroy(mm);
    clock.destroy_for_testing();
}

#[test]
/// 300 players leave the queue in the order they joined.
fun bench_cancel() {
    let (mut mm, clock, mut rng) = setup();
    fill(&mut mm, &mut rng, &clock, 10, 19);

    10u64.range_do_eq!(19, |bucket| PER_BUCKET.do!(|i| {
        let n = bucket * 100 + i;
        mm.cancel_game(&mut tx_context::new_from_hint(player(n), n, 0, 0, 0));
    }));
    assert_eq!(mm.queue_length(), 0);

    destroy(mm);
    clock.destroy_for_testing();
}

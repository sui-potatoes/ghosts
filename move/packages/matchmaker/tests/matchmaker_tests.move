// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

module matchmaker::matchmaker_tests;

use matchmaker::matchmaker::{Self, Matchmaker, MatchFound};
use std::unit_test::{assert_eq, destroy};
use sui::{clock::{Self, Clock}, event, random};

/// Type identifying the game under test; needs no abilities.
public struct TEST()

const ALICE: address = @0xA;
const BOB: address = @0xB;
const CAROL: address = @0xC;

const MINUTE: u64 = 60_000;

fun setup(): (Matchmaker<TEST>, Clock) {
    let ctx = &mut tx_context::dummy();
    let mm = matchmaker::new(internal::permit<TEST>(), matchmaker::default_config(), ctx);
    (mm, clock::create_for_testing(ctx))
}

/// Context of `sender`; the hint keeps order IDs of different senders apart.
fun ctx_for(sender: address): TxContext {
    tx_context::new_from_hint(sender, sender.to_u256() as u64, 0, 0, 0)
}

/// `find_game` as `sender` with the test permit and a fixed seed.
fun find_game(
    mm: &mut Matchmaker<TEST>,
    sender: address,
    rating: u64,
    window: u64,
    clock: &Clock,
): (ID, Option<matchmaker::Match>) {
    let mut rng = random::new_generator_from_seed_for_testing(b"matchmaker");
    let ctx = &mut ctx_for(sender);
    matchmaker::find_game(internal::permit<TEST>(), mm, rating, window, &mut rng, clock, ctx)
}

/// `find_game` without the order ID.
fun find(
    mm: &mut Matchmaker<TEST>,
    sender: address,
    rating: u64,
    window: u64,
    clock: &Clock,
): Option<matchmaker::Match> {
    let (_, found) = find_game(mm, sender, rating, window, clock);
    found
}

#[test]
fun queue_and_cancel() {
    let (mut mm, clock) = setup();

    let found = find(&mut mm, ALICE, 1500, 350, &clock);
    assert!(found.is_none());
    found.destroy_none();

    assert!(mm.is_queued(ALICE));
    assert_eq!(mm.queue_length(), 1);
    assert_eq!(mm.occupied(), 1u256 << 15); // bucket 1500 / 100

    mm.cancel_game(&mut ctx_for(ALICE));
    assert!(!mm.is_queued(ALICE));
    assert_eq!(mm.queue_length(), 0);
    assert_eq!(mm.occupied(), 0);

    destroy(mm);
    clock.destroy_for_testing();
}

#[test, expected_failure(abort_code = matchmaker::ENotQueued)]
fun cancel_when_not_queued() {
    let (mut mm, _clock) = setup();
    mm.cancel_game(&mut ctx_for(ALICE));
    abort
}

#[test, expected_failure(abort_code = matchmaker::EAlreadyQueued)]
fun find_twice() {
    let (mut mm, clock) = setup();
    find(&mut mm, ALICE, 1500, 350, &clock).destroy_none();
    find(&mut mm, ALICE, 1500, 350, &clock).destroy_none();
    abort
}

#[test]
fun match_two_players() {
    let (mut mm, clock) = setup();

    let (order, found) = find_game(&mut mm, ALICE, 1500, 350, &clock);
    found.destroy_none();
    let (bob_order, found) = find_game(&mut mm, BOB, 1500, 350, &clock);
    let m = found.destroy_some();

    // waiting player comes first, and the match carries their order ID
    assert_eq!(m.players(), vector[ALICE, BOB]);
    assert_eq!(m.match_id(), order);
    assert!(bob_order != order);
    assert_eq!(mm.queue_length(), 0);
    assert_eq!(mm.occupied(), 0);
    assert!(!mm.is_queued(ALICE));
    assert!(!mm.is_queued(BOB));

    let found = event::events_by_type<MatchFound>();
    assert_eq!(found.length(), 1);

    destroy(mm);
    clock.destroy_for_testing();
}

#[test]
fun match_across_buckets() {
    let (mut mm, clock) = setup();

    // 1495 and 1505 sit in different 100-point buckets, 10 points apart
    find(&mut mm, ALICE, 1495, 30, &clock).destroy_none();
    assert_eq!(mm.occupied(), 1u256 << 14);
    let m = find(&mut mm, BOB, 1505, 30, &clock);
    assert_eq!(m.destroy_some().players(), vector[ALICE, BOB]);
    assert_eq!(mm.queue_length(), 0);

    destroy(mm);
    clock.destroy_for_testing();
}

#[test]
fun ratings_above_range_share_top_bucket() {
    let (mut mm, clock) = setup();

    find(&mut mm, ALICE, 1_000_000, 0, &clock).destroy_none();
    assert_eq!(mm.occupied(), 1u256 << 255);

    // same bucket, but a zero window still needs an exact rating
    find(&mut mm, BOB, 2_000_000, 0, &clock).destroy_none();
    assert_eq!(mm.queue_length(), 2);

    let m = find(&mut mm, CAROL, 1_000_000, 0, &clock);
    assert_eq!(m.destroy_some().players(), vector[ALICE, CAROL]);
    assert!(mm.is_queued(BOB));

    destroy(mm);
    clock.destroy_for_testing();
}

#[test]
fun window_expands_with_waiting() {
    let (mut mm, mut clock) = setup();
    // +100 points per minute, capped at 1000; tickets live for an hour
    matchmaker::set_config(
        internal::permit<TEST>(),
        &mut mm,
        matchmaker::new_config(100, 32, 100, MINUTE, 1_000, 60 * MINUTE),
    );

    // t = 0: windows are 50 + 50, far from the 1000 gap
    find(&mut mm, ALICE, 1000, 50, &clock).destroy_none();
    find(&mut mm, BOB, 2000, 50, &clock).destroy_none();
    assert_eq!(mm.queue_length(), 2);
    assert_eq!(mm.occupied(), (1u256 << 10) | (1u256 << 20));

    // t = 5m: Alice's window is 550, Bob re-queues fresh with 50
    clock.set_for_testing(5 * MINUTE);
    mm.cancel_game(&mut ctx_for(BOB));
    find(&mut mm, BOB, 2000, 50, &clock).destroy_none();
    assert_eq!(mm.queue_length(), 2);

    // t = 10m: Alice's window is capped at 1000, 1000 + 50 covers the gap
    clock.set_for_testing(10 * MINUTE);
    mm.cancel_game(&mut ctx_for(BOB));
    let m = find(&mut mm, BOB, 2000, 50, &clock);
    assert_eq!(m.destroy_some().players(), vector[ALICE, BOB]);
    assert_eq!(mm.queue_length(), 0);
    assert_eq!(mm.occupied(), 0);

    destroy(mm);
    clock.destroy_for_testing();
}

#[test]
fun nearest_ring_wins() {
    let (mut mm, clock) = setup();

    // windows are 30 + 30: Alice and Bob are 100 apart and both wait
    find(&mut mm, ALICE, 1500, 30, &clock).destroy_none();
    find(&mut mm, BOB, 1600, 30, &clock).destroy_none();
    assert_eq!(mm.queue_length(), 2);

    // Carol at 1540 fits both, but only Alice shares her bucket: ring 0 holds a
    // compatible ticket, so the search never reaches Bob in ring 1
    let m = find(&mut mm, CAROL, 1540, 30, &clock);
    assert_eq!(m.destroy_some().players(), vector[ALICE, CAROL]);
    assert!(mm.is_queued(BOB));
    assert!(!mm.is_queued(ALICE));

    destroy(mm);
    clock.destroy_for_testing();
}

#[test]
fun opponent_is_drawn_at_random() {
    let (mut mm, clock) = setup();
    let seeds = vector[b"1", b"2", b"3", b"4", b"5", b"6", b"7", b"8"];
    let mut drawn = vector[];

    seeds.do!(|seed| {
        // Alice in bucket 14, Bob in bucket 16; 210 apart, windows 100 + 100: no match
        find(&mut mm, ALICE, 1440, 100, &clock).destroy_none();
        find(&mut mm, BOB, 1650, 100, &clock).destroy_none();

        // Carol at 1590 in bucket 15: ring 0 is empty, ring 1 holds both, and
        // either can be drawn however far from Carol (150 and 60)
        let mut rng = random::new_generator_from_seed_for_testing(seed);
        let ctx = &mut ctx_for(CAROL);
        let permit = internal::permit<TEST>();
        let (_, m) = matchmaker::find_game(permit, &mut mm, 1590, 100, &mut rng, &clock, ctx);
        let waited = m.destroy_some().players()[0];
        if (!drawn.contains(&waited)) drawn.push_back(waited);

        // the other one leaves, the queue is empty for the next draw
        mm.cancel_game(&mut ctx_for(if (waited == ALICE) BOB else ALICE));
        assert_eq!(mm.queue_length(), 0);
    });

    assert_eq!(drawn.length(), 2);

    destroy(mm);
    clock.destroy_for_testing();
}

#[test]
fun expired_tickets_are_pruned() {
    let (mut mm, mut clock) = setup();
    matchmaker::set_config(
        internal::permit<TEST>(),
        &mut mm,
        matchmaker::new_config(100, 32, 50, MINUTE, 1_000, MINUTE),
    );

    find(&mut mm, ALICE, 1500, 350, &clock).destroy_none();

    // Bob arrives after Alice's ticket expired: no match, Alice is gone
    clock.set_for_testing(2 * MINUTE);
    find(&mut mm, BOB, 1500, 350, &clock).destroy_none();
    assert!(!mm.is_queued(ALICE));
    assert!(mm.is_queued(BOB));
    assert_eq!(mm.queue_length(), 1);
    assert_eq!(mm.occupied(), 1u256 << 15);

    destroy(mm);
    clock.destroy_for_testing();
}

#[test]
fun expired_own_ticket_is_replaced() {
    let (mut mm, mut clock) = setup();
    matchmaker::set_config(
        internal::permit<TEST>(),
        &mut mm,
        matchmaker::new_config(100, 32, 50, MINUTE, 1_000, MINUTE),
    );

    find(&mut mm, ALICE, 1500, 350, &clock).destroy_none();

    // Alice comes back after her ticket expired: re-queued, not aborted
    clock.set_for_testing(2 * MINUTE);
    find(&mut mm, ALICE, 1500, 350, &clock).destroy_none();
    assert!(mm.is_queued(ALICE));
    assert_eq!(mm.queue_length(), 1);

    // and the fresh ticket is matchable
    let m = find(&mut mm, BOB, 1500, 350, &clock);
    assert_eq!(m.destroy_some().players(), vector[ALICE, BOB]);

    destroy(mm);
    clock.destroy_for_testing();
}

#[test]
fun full_bucket_evicts_oldest() {
    let (mut mm, clock) = setup();
    matchmaker::set_config(
        internal::permit<TEST>(),
        &mut mm,
        matchmaker::new_config(100, 2, 50, MINUTE, 1_000, 10 * MINUTE),
    );

    // zero windows and distinct ratings: nobody matches, all in bucket 15
    find(&mut mm, ALICE, 1500, 0, &clock).destroy_none();
    find(&mut mm, BOB, 1501, 0, &clock).destroy_none();
    assert_eq!(mm.queue_length(), 2);

    find(&mut mm, CAROL, 1502, 0, &clock).destroy_none();
    assert_eq!(mm.queue_length(), 2);
    assert!(!mm.is_queued(ALICE));
    assert!(mm.is_queued(BOB));
    assert!(mm.is_queued(CAROL));

    destroy(mm);
    clock.destroy_for_testing();
}

#[test]
fun zero_window_requires_exact_rating() {
    let (mut mm, clock) = setup();

    find(&mut mm, ALICE, 1500, 0, &clock).destroy_none();
    find(&mut mm, BOB, 1501, 0, &clock).destroy_none();
    assert_eq!(mm.queue_length(), 2);

    let m = find(&mut mm, CAROL, 1500, 0, &clock);
    assert_eq!(m.destroy_some().players(), vector[ALICE, CAROL]);

    destroy(mm);
    clock.destroy_for_testing();
}

#[test, expected_failure(abort_code = matchmaker::EQueueNotEmpty)]
fun set_config_with_waiting_players() {
    let (mut mm, clock) = setup();
    find(&mut mm, ALICE, 1500, 350, &clock).destroy_none();
    matchmaker::set_config(internal::permit<TEST>(), &mut mm, matchmaker::default_config());
    abort
}

#[test, expected_failure(abort_code = matchmaker::EInvalidConfig)]
fun config_rejects_zero_interval() {
    let _ = matchmaker::new_config(100, 32, 50, 0, 1_000, MINUTE);
}

#[test, expected_failure(abort_code = matchmaker::EInvalidConfig)]
fun config_rejects_zero_bucket() {
    let _ = matchmaker::new_config(0, 32, 50, MINUTE, 1_000, MINUTE);
}

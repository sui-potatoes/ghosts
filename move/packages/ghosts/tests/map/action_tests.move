// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

module ghosts::action_tests;

use ghosts::action;
use std::{bcs, unit_test::assert_eq};

#[test]
// Variant order is the BCS tag: pinned, new variants are only appended.
fun tag_order() {
    assert_eq!(bcs::to_bytes(&action::new_move()), vector[0]);
    assert_eq!(bcs::to_bytes(&action::new_attack()), vector[1]);
    assert_eq!(bcs::to_bytes(&action::new_reload()), vector[2]);
    assert_eq!(bcs::to_bytes(&action::new_grenade()), vector[3]);
}

#[test]
// An `Action` is its `uses` option, then its kind: pinned.
fun byte_layout() {
    assert_eq!(bcs::to_bytes(&action::unlimited(action::new_attack())), vector[0, 1]);
    assert_eq!(bcs::to_bytes(&action::limited(action::new_grenade(), 2)), vector[1, 2, 3]);
    assert_eq!(bcs::to_bytes(&action::new(action::new_move(), option::some(0))), vector[1, 0, 0]);
}

#[test]
fun from_bytes_round_trip() {
    let actions = vector[
        action::unlimited(action::new_move()),
        action::limited(action::new_grenade(), 1),
    ];
    let bytes = bcs::to_bytes(&actions);
    let mut reader = sui::bcs::new(bytes);
    let read = reader.peel_vec!(|bcs| action::from_bcs(bcs));
    assert_eq!(read, actions);
}

#[test]
// A limited action can be spent `uses` times; an unlimited one never runs out.
fun spend() {
    let mut limited = action::limited(action::new_grenade(), 2);
    assert!(limited.has_uses());
    limited.spend();
    assert_eq!(limited.uses(), option::some(1));
    limited.spend();
    assert_eq!(limited.uses(), option::some(0));
    assert!(!limited.has_uses());

    let mut unlimited = action::unlimited(action::new_move());
    10u8.do!(|_| unlimited.spend());
    assert!(unlimited.has_uses());
    assert_eq!(unlimited.uses(), option::none());
    assert_eq!(unlimited.kind(), action::new_move());
}

#[test, expected_failure(abort_code = 0, location = ghosts::action)]
fun spend_past_zero_fail() {
    let mut once = action::limited(action::new_grenade(), 1);
    once.spend();
    once.spend();
}

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

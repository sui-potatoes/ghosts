// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

#[test_only]
extend module ghosts::effect;

use std::unit_test::assert_eq;

/// The byte an `Effect` is, for tests that check the wire format.
public fun to_byte(e: &Effect): u8 { e.0 }

#[test]
/// The two kinds, their tags and turns, packed in one byte each.
fun constructors_and_layout() {
    let (daze, smoke) = (daze(), smoke());
    assert_eq!(daze.kind(), DAZE);
    assert_eq!(daze.turns(), DAZE_TURNS);
    assert!(daze.is_daze() && !daze.is_smoke());
    assert_eq!(smoke.kind(), SMOKE);
    assert_eq!(smoke.turns(), SMOKE_TURNS);
    assert!(smoke.is_smoke() && !smoke.is_daze());

    // kind << 4 | turns, one byte on the wire
    assert_eq!(std::bcs::to_bytes(&daze), vector[0x02]);
    assert_eq!(std::bcs::to_bytes(&smoke), vector[0x12]);
    assert_eq!(new(SMOKE, MAX_TURNS).to_byte(), 0x1F);
}

#[test]
/// A tick takes one turn off and says whether any are left.
fun tick_counts_down() {
    let mut e = new(SMOKE, 3);
    assert!(e.tick());
    assert_eq!(e.turns(), 2);
    assert!(e.tick());
    assert!(!e.tick());
    assert_eq!(e.turns(), 0);
    assert_eq!(e.kind(), SMOKE);
}

#[test]
/// A refresh keeps the larger of the two timers.
fun refresh_takes_the_larger() {
    let mut e = new(DAZE, 1);
    e.refresh(new(DAZE, 2));
    assert_eq!(e.turns(), 2);
    e.refresh(new(DAZE, 1));
    assert_eq!(e.turns(), 2);
    assert_eq!(e.kind(), DAZE);
}

#[test]
/// The modifiers: daze takes all aim, smoke takes 30 aim and adds 30 defense;
/// nothing else is touched.
fun modifiers() {
    let base = ghosts::stats::default();
    let dazed = base.add(&daze().modifier());
    assert_eq!(dazed.aim(), 0);
    assert_eq!(dazed.defense(), base.defense());
    assert_eq!(dazed.mobility(), base.mobility());

    let smoked = base.add(&smoke().modifier());
    assert_eq!(smoked.aim(), base.aim() - SMOKE_AIM_PENALTY);
    assert_eq!(smoked.defense(), base.defense() + SMOKE_DEFENSE);
    assert_eq!(smoked.mobility(), base.mobility());
    assert_eq!(smoked.health(), base.health());

    // smoke floors at zero
    let low = ghosts::stats::new(7, 10, 10, 0, 0).add(&smoke().modifier());
    assert_eq!(low.aim(), 0);
}

#[test]
fun bcs_round_trip() {
    let bytes = std::bcs::to_bytes(&vector[daze(), smoke(), new(SMOKE, 15)]);
    let mut bcs = sui::bcs::new(bytes);
    let effects = bcs.peel_vec!(|bcs| from_bcs(bcs));
    assert_eq!(effects, vector[daze(), smoke(), new(SMOKE, 15)]);
}

#[test, expected_failure(abort_code = EInvalidEffect)]
fun unknown_kind_fails() { new(LAST_KIND + 1, 1); }

#[test, expected_failure(abort_code = EInvalidEffect)]
fun zero_turns_fails() { new(DAZE, 0); }

#[test, expected_failure(abort_code = EInvalidEffect)]
fun decode_expired_fails() { from_bcs(&mut sui::bcs::new(vector[0x10])); }

/// The effect with one turn taken off, as `Unit.tick_effects` returns the ones
/// that ran out.
public fun ticked(mut e: Effect): Effect {
    e.0 = e.0 - 1;
    e
}

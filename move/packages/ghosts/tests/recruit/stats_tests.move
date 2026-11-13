// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/// Universal stats for Recruits and their equipment, and for `Unit`s.
///
/// Stats are built in a way that allows easy modification, negation and
/// addition. Recruit stats are distributed in their equipment, and during the
/// conversion to `Unit` (pre-battle), the stats are combined into a single
/// `Stats` value.
module ghosts::stats_tests;

use ghosts::stats;
use std::unit_test::assert_eq;

const SIGN_VALUE: u8 = 0x80;

#[test]
fun test_in_game_stats() {
    let stats = stats::new_unchecked(15658020524713025353488063875662087);

    assert_eq!(stats.mobility(), 7);
    assert_eq!(stats.aim(), 65);
    assert_eq!(stats.health(), 10);
    assert_eq!(stats.armor(), 0);
    assert_eq!(stats.dodge(), 0);
    assert_eq!(stats.defense(), 0);
}

#[test]
fun test_stats() {
    let stats = stats::new(
        7, // mobility
        50, // aim
        10, // health
        0, // armor
        0, // dodge
    );

    assert_eq!(stats.mobility(), 7);
    assert_eq!(stats.aim(), 50);
    assert_eq!(stats.health(), 10);
    assert_eq!(stats.armor(), 0);
    assert_eq!(stats.dodge(), 0);
}

#[test]
fun test_defaults() {
    let stats = stats::default();

    assert_eq!(stats.mobility(), 7);
    assert_eq!(stats.aim(), 65);
    assert_eq!(stats.health(), 10);
    assert_eq!(stats.armor(), 0);
    assert_eq!(stats.dodge(), 0);
    assert_eq!(stats.defense(), 0);

    assert_eq!(stats.damage(), 0);
    assert_eq!(stats.spread(), 0);
    assert_eq!(stats.plus_one(), 0);
    assert_eq!(stats.crit_chance(), 0);
    assert_eq!(stats.can_be_dodged(), 0);
    assert_eq!(stats.area_size(), 0);
    assert_eq!(stats.env_damage(), 0);
    assert_eq!(stats.range(), 0);
    assert_eq!(stats.ammo(), 0);

    let weapon_stats = stats::default_weapon();

    assert_eq!(weapon_stats.damage(), 4);
    assert_eq!(weapon_stats.spread(), 2);
    assert_eq!(weapon_stats.plus_one(), 0);
    assert_eq!(weapon_stats.crit_chance(), 0);
    assert_eq!(weapon_stats.can_be_dodged(), 1);
    assert_eq!(weapon_stats.area_size(), 0);
    assert_eq!(weapon_stats.env_damage(), 0);
    assert_eq!(weapon_stats.range(), 4);
    assert_eq!(weapon_stats.ammo(), 3);

    assert_eq!(weapon_stats.mobility(), 0);
    assert_eq!(weapon_stats.aim(), 0);
    assert_eq!(weapon_stats.health(), 0);
    assert_eq!(weapon_stats.armor(), 0);
    assert_eq!(weapon_stats.dodge(), 0);
    assert_eq!(weapon_stats.defense(), 0);
}

#[test]
fun test_with_modifier() {
    let stats = stats::new(7, 50, 10, 0, 0);
    let modifier = stats::new(128 + 2, 30, 0, 0, 0); // hyperfocus modifier: -2 mobility, +30 aim
    let modified = stats.add(&modifier); // apply the modifier and check the new stats

    assert_eq!(modified.mobility(), 5);
    assert_eq!(modified.aim(), 80);
    assert_eq!(modified.health(), 10);
    assert_eq!(modified.armor(), 0);
    assert_eq!(modified.dodge(), 0);

    // test negation
    assert_eq!(modified.add(&modifier.negate()), stats);

    // test overflow (max value) and underflow (arithmetic error) protection
    let modifier = stats::new(127, 0, 0, 255, 255);
    let modified = modified.add(&modifier);

    assert_eq!(modified.mobility(), SIGN_VALUE - 1); // overflow -> capped
    assert_eq!(modified.armor(), 0); // underflow -> 0
    assert_eq!(modified.dodge(), 0); // underflow -> 0
}

#[test]
fun test_to_string() {
    assert_eq!(
        stats::default().to_string(),
        "MOB:7 AIM:65 HP:10 ARM:0 DOG:0 DEF:0 DMG:0 SPR:0 PLO:0 CRT:0 IDG:0 ARS:0 ENV:0 RAN:0 AMM:0",
    );

    // a modifier: -1 MOB, +1 HP, +3 ARM, -10 DOG
    let heavy = stats::new_unchecked(
        bit_field::bit_field::pack_u8!(vector[SIGN_VALUE + 1, 0, 1, 3, SIGN_VALUE + 10]),
    );
    assert_eq!(
        heavy.to_string(),
        "MOB:-1 AIM:0 HP:1 ARM:3 DOG:-10 DEF:0 DMG:0 SPR:0 PLO:0 CRT:0 IDG:0 ARS:0 ENV:0 RAN:0 AMM:0",
    );
}

/// `add` as it was written with `bit_field` vectors: the reference the packed
/// implementation must agree with.
fun add_reference(stats: &stats::Stats, modifier: &stats::Stats): stats::Stats {
    use bit_field::bit_field as bf;

    let mut values = bf::unpack_u8!(stats.inner(), 15);
    let modifiers = bf::unpack_u8!(modifier.inner(), 15);
    15u64.do!(|i| {
        let (modifier, value) = (modifiers[i], values[i]);
        if (modifier == 0 || modifier == SIGN_VALUE) return;
        let new_value = if (modifier > SIGN_VALUE) value - (modifier - SIGN_VALUE).min(value)
        else value + modifier;
        *&mut values[i] = new_value.min(SIGN_VALUE - 1);
    });
    stats::new_unchecked(bf::pack_u8!(values))
}

#[test]
/// Random stats (every value below the sign bit, all 16 bytes set) and random
/// modifiers (any byte, zeros and negative zeros mixed in) add up the same as
/// the reference.
fun test_add_matches_reference() {
    let mut rng = sui::random::new_generator_from_seed_for_testing(b"stats_add");
    200u64.do!(|_| {
        let stats = stats::new_unchecked(
            rng.generate_u128() & 0x7F7F_7F7F_7F7F_7F7F_7F7F_7F7F_7F7F_7F7F,
        );
        let mut modifier = rng.generate_u128();
        // clear some bytes and set others to -0, so the skips are exercised
        let mask = rng.generate_u16();
        16u8.do!(|i| {
            if (mask >> i & 1 == 1) modifier = modifier & (0xFFu128 << (8 * i)).bitwise_not();
            if (mask >> i & 3 == 2) modifier = modifier | (0x80u128 << (8 * i));
        });
        let modifier = stats::new_unchecked(modifier);
        assert_eq!(stats.add(&modifier), add_reference(&stats, &modifier));
    });
    // and the real gear: a weapon, an armor and nothing
    let base = stats::default();
    assert_eq!(base.add(&stats::default_weapon()), add_reference(&base, &stats::default_weapon()));
    assert_eq!(base.add(&stats::default_armor()), add_reference(&base, &stats::default_armor()));
}

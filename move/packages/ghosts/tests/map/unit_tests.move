// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

module ghosts::unit_tests;

use ghosts::{action, items, recruit::{Self, Recruit}, stats, stats_builder, unit, weapon};
use std::{bcs, unit_test::assert_eq};
use sui::random;

/// A recruit with a weapon of the default weapon stats: the same numbers an
/// unarmed recruit has, plus the actions the weapon gives.
fun armed_recruit(ctx: &mut TxContext): Recruit {
    let mut recruit = recruit::default(ctx);
    recruit.add_weapon(weapon::new(b"Test".to_string(), stats::default_weapon(), ctx));
    recruit
}

/// A recruit carrying the frag grenade.
fun grenadier(ctx: &mut TxContext): Recruit {
    let mut recruit = recruit::default(ctx);
    recruit.add_utility(items::frag_grenade(ctx));
    recruit
}

#[test]
fun default() {
    let ctx = &mut tx_context::dummy();
    let mut rng = random::new_generator_from_seed_for_testing(vector[0]);
    let recruit = recruit::default(ctx);
    let mut unit = recruit.to_unit();

    // make sure the conversion is correct
    // assert_eq!(unit.stats, *recruit.stats());
    assert_eq!(unit.hp(), recruit.stats().health() as u16);
    assert_eq!(unit.ap(), 2);

    // now test application of damage to the unit
    // for simplicity we'll use the same unit
    unit.apply_damage(&mut rng, 5, true);
    assert_eq!(unit.hp(), 5);

    let (weapon, armor, utilities) = recruit.dismiss();
    utilities.destroy!(|u| u.destroy());
    weapon.destroy_none();
    armor.destroy_none();
    unit.destroy();
}

#[test]
// Armor modifiers land on the recruit, including negative ones: heavy armor
// is -1 MOB, +1 HP, +3 ARM, -10 DODGE on a default recruit (7, 65, 10, 0, 0)
// carrying the default weapon.
fun armor_modifiers_reach_the_recruit() {
    let ctx = &mut tx_context::dummy();
    let mut recruit = recruit::default(ctx);
    recruit.add_armor(items::armor(3, ctx));
    let unit = recruit.to_unit();

    assert_eq!(unit.stats().mobility(), 6);
    assert_eq!(unit.stats().health(), 11);
    assert_eq!(unit.hp(), 11);
    assert_eq!(unit.stats().armor(), 3);
    assert_eq!(unit.stats().dodge(), 0); // 0 - 10 floors at zero
    assert_eq!(unit.stats().aim(), 65);
    // the default weapon still comes through
    assert_eq!(unit.stats().damage(), 4);
    assert_eq!(unit.ammo(), 3);

    let (weapon, armor, utilities) = recruit.dismiss();
    utilities.destroy!(|u| u.destroy());
    weapon.destroy_none();
    armor.destroy_some().destroy();
    unit.destroy();

    // light armor: +1 ARM, +10 DODGE, no penalties
    let mut recruit = recruit::default(ctx);
    recruit.add_armor(items::armor(1, ctx));
    let unit = recruit.to_unit();

    assert_eq!(unit.stats().mobility(), 7);
    assert_eq!(unit.stats().armor(), 1);
    assert_eq!(unit.stats().dodge(), 10);

    let (weapon, armor, utilities) = recruit.dismiss();
    utilities.destroy!(|u| u.destroy());
    weapon.destroy_none();
    armor.destroy_some().destroy();
    unit.destroy();
}

#[test]
// Scenario:
// - perform attack, next turn
// - reload
fun perform_reload() {
    let ctx = &mut tx_context::dummy();
    let mut rng = random::new_generator_from_seed_for_testing(vector[0]);
    let recruit = armed_recruit(ctx);
    let mut unit = recruit.to_unit();

    unit.perform_attack(&mut rng, 1, 0);
    unit.reset_ap();
    unit.perform_reload();

    let (weapon, armor, utilities) = recruit.dismiss();
    utilities.destroy!(|u| u.destroy());
    weapon.do!(|weapon| weapon.destroy());
    armor.destroy_none();
    unit.destroy();
}

#[test, expected_failure(abort_code = unit::ENoAP)]
// Scenario:
// - reload at full clip capacity - fail
fun perform_reload_no_ap_fail() {
    let ctx = &mut tx_context::dummy();
    let mut rng = random::new_generator_from_seed_for_testing(vector[0]);
    let recruit = armed_recruit(ctx);
    let mut unit = recruit.to_unit();

    unit.perform_attack(&mut rng, 1, 0);
    unit.perform_reload();

    abort
}

#[test, expected_failure(abort_code = unit::EFullAmmo)]
// Scenario:
// - reload at full clip capacity - fail
fun perform_reload_full_clip_fail() {
    let ctx = &mut tx_context::dummy();
    let recruit = armed_recruit(ctx);
    let mut unit = recruit.to_unit();

    unit.perform_reload();

    abort
}

#[test]
// Scenario:
// - throw a grenade
// - check AP and the uses of the action
fun perform_grenade() {
    let ctx = &mut tx_context::dummy();
    let recruit = grenadier(ctx);
    let mut unit = recruit.to_unit();

    assert_eq!(unit.actions()[1].uses(), option::some(1));
    assert_eq!(unit.ap(), 2);
    unit.perform_grenade();

    assert_eq!(unit.ap(), 1);
    assert_eq!(unit.actions()[1].uses(), option::some(0));
    assert!(unit.has_action(action::new_grenade()));

    recruit.kill(ctx).throw_away();
    unit.destroy();
}

#[test, expected_failure(abort_code = unit::ENoUsesLeft)]
// Scenario:
// - throw grenade twice - fail - uses spent
fun perform_grenade_twice_fail() {
    let ctx = &mut tx_context::dummy();
    let recruit = grenadier(ctx);
    let mut unit = recruit.to_unit();

    unit.perform_grenade();
    unit.perform_grenade();

    abort
}

#[test, expected_failure(abort_code = unit::EActionNotAllowed, location = unit)]
// A recruit with no utility has no grenade to throw.
fun perform_grenade_without_utility_fail() {
    let ctx = &mut tx_context::dummy();
    let mut unit = recruit::default(ctx).to_unit();

    unit.perform_grenade();
    abort
}

#[test, expected_failure(abort_code = unit::ENoAP)]
// Scenario:
// - deplete AP by performing an attack
// - try throwing a grenade
fun perform_grenade_no_ap_fail() {
    let ctx = &mut tx_context::dummy();
    let mut rng = random::new_generator_from_seed_for_testing(vector[0]);
    let mut recruit = armed_recruit(ctx);
    recruit.add_utility(items::frag_grenade(ctx));
    let mut unit = recruit.to_unit();

    unit.perform_attack(&mut rng, 4, 0);
    unit.perform_grenade();

    abort
}

#[test]
fun perform_attack_distance_modifiers() {
    let ctx = &mut tx_context::dummy();
    let mut rng = random::new_generator_from_seed_for_testing(vector[0]);
    let recruit = armed_recruit(ctx);
    let mut unit = recruit.to_unit();

    assert_eq!(unit.stats().range(), 4);
    assert_eq!(unit.stats().aim(), 65);

    // 15% bonus
    let (_, _, _, _, hit_chance) = unit.perform_attack(&mut rng, 1, 0);
    assert_eq!(hit_chance, 80);
    unit.reset_ap();

    // 10% bonus
    let (_, _, _, _, hit_chance) = unit.perform_attack(&mut rng, 2, 0);
    assert_eq!(hit_chance, 75);
    unit.reset_ap();

    // 5% bonus
    let (_, _, _, _, hit_chance) = unit.perform_attack(&mut rng, 3, 0);
    assert_eq!(hit_chance, 70);
    unit.reset_ap();

    // no bonus, no penalty
    unit.perform_reload();
    let (_, _, _, _, hit_chance) = unit.perform_attack(&mut rng, 4, 0);
    assert_eq!(hit_chance, 65);
    unit.reset_ap();

    // 10% penalty
    let (_, _, _, _, hit_chance) = unit.perform_attack(&mut rng, 5, 0);
    assert_eq!(hit_chance, 55);
    unit.reset_ap();

    // 20% penalty
    let (_, _, _, _, hit_chance) = unit.perform_attack(&mut rng, 6, 0);
    assert_eq!(hit_chance, 45);
    unit.reset_ap();

    // 30% penalty
    unit.perform_reload();
    let (_, _, _, _, hit_chance) = unit.perform_attack(&mut rng, 7, 0);
    assert_eq!(hit_chance, 35);
    unit.reset_ap();

    recruit.kill(ctx).throw_away();
    unit.destroy();
}

#[test]
fun shoot_and_reload() {
    let ctx = &mut tx_context::dummy();
    let mut rng = random::new_generator_from_seed_for_testing(vector[0]);
    let recruit = armed_recruit(ctx);
    let mut unit = recruit.to_unit();

    assert_eq!(unit.ammo(), 3);
    unit.perform_attack(&mut rng, 1, 0);
    assert_eq!(unit.ammo(), 2);
    unit.reset_ap();
    unit.perform_reload();
    assert_eq!(unit.ammo(), 3);
    assert_eq!(unit.ap(), 1);
    unit.perform_attack(&mut rng, 1, 0);
    assert_eq!(unit.ammo(), 2);
    unit.reset_ap();
    unit.perform_attack(&mut rng, 1, 0);
    assert_eq!(unit.ammo(), 1);
    unit.reset_ap();
    unit.perform_attack(&mut rng, 1, 0);
    assert_eq!(unit.ammo(), 0);

    recruit.kill(ctx).throw_away();
    unit.destroy();
}

#[test]
fun unit_custom_weapon() {
    let ctx = &mut tx_context::dummy();
    let mut recruit = recruit::default(ctx);
    let weapon = weapon::new(
        b"Test Rifle".to_string(),
        stats_builder::new().damage(7).build_weapon(),
        ctx,
    );

    recruit.add_weapon(weapon);

    let unit = recruit.to_unit();
    let (weapon, armor, utilities) = recruit.dismiss();
    utilities.destroy!(|u| u.destroy());

    assert_eq!(unit.stats().damage(), 7);

    weapon.do!(|weapon| weapon.destroy());
    armor.do!(|armor| armor.destroy());
    unit.destroy();
}

#[test]
fun from_bcs() {
    let ctx = &mut tx_context::dummy();
    let recruit = recruit::default(ctx);
    let unit = recruit.to_unit();

    let bytes = bcs::to_bytes(&unit);
    let unit2 = unit::from_bytes(bytes);

    assert_eq!(unit.recruit_id(), unit2.recruit_id());
    assert_eq!(*unit.actions(), *unit2.actions());
    assert_eq!(bcs::to_bytes(&unit2), bytes);
    let (weapon, armor, utilities) = recruit.dismiss();
    utilities.destroy!(|u| u.destroy());
    weapon.do!(|weapon| weapon.destroy());
    armor.do!(|armor| armor.destroy());
    unit2.destroy();
    unit.destroy();
}

#[test]
fun armed_recruit_has_weapon_actions() {
    let ctx = &mut tx_context::dummy();
    let recruit = armed_recruit(ctx);
    let unit = recruit.to_unit();

    assert_eq!(
        *unit.actions(),
        vector[
            action::unlimited(action::new_move()),
            action::unlimited(action::new_attack()),
            action::unlimited(action::new_reload()),
        ],
    );
    assert!(unit.has_action(action::new_attack()));

    recruit.kill(ctx).throw_away();
    unit.destroy();
}

#[test]
// An unarmed recruit with no utility only moves; the grenade adds its action after
// the weapon's.
fun unarmed_recruit_has_move_only() {
    let ctx = &mut tx_context::dummy();
    let recruit = recruit::default(ctx);
    let mut unit = recruit.to_unit();

    assert_eq!(*unit.actions(), vector[action::unlimited(action::new_move())]);
    assert!(!unit.has_action(action::new_grenade()));
    assert!(!unit.has_action(action::new_attack()));
    assert!(!unit.has_action(action::new_reload()));

    // moving still works
    unit.perform_move(1);
    assert_eq!(unit.ap(), 1);

    recruit.kill(ctx).throw_away();
    unit.destroy();
}

#[test]
// The grenade is an action of the utility item, after those of the weapon, and the
// item changes nothing else about the unit.
fun grenadier_has_grenade_action() {
    let ctx = &mut tx_context::dummy();
    let mut recruit = armed_recruit(ctx);
    let without = recruit.to_unit();
    recruit.add_utility(items::frag_grenade(ctx));
    let unit = recruit.to_unit();

    assert_eq!(
        *unit.actions(),
        vector[
            action::unlimited(action::new_move()),
            action::unlimited(action::new_attack()),
            action::unlimited(action::new_reload()),
            action::limited(action::new_grenade(), 1),
        ],
    );
    // the grenade is a zero modifier: the same stats with and without it
    assert_eq!(unit.stats().inner(), without.stats().inner());

    recruit.kill(ctx).throw_away();
    unit.destroy();
    without.destroy();
}

#[test, expected_failure(abort_code = unit::EActionNotAllowed, location = unit)]
fun unarmed_recruit_cannot_attack() {
    let ctx = &mut tx_context::dummy();
    let mut rng = random::new_generator_from_seed_for_testing(vector[0]);
    let mut unit = recruit::default(ctx).to_unit();

    unit.perform_attack(&mut rng, 1, 0);
    abort
}

#[test, expected_failure(abort_code = unit::EActionNotAllowed, location = unit)]
fun unarmed_recruit_cannot_reload() {
    let ctx = &mut tx_context::dummy();
    let mut unit = recruit::default(ctx).to_unit();

    unit.perform_reload();
    abort
}

#[test]
fun to_string() {
    let ctx = &mut tx_context::dummy();
    let recruit = recruit::default(ctx);
    let unit = recruit.to_unit();

    assert_eq!(unit.to_string(), b"HP 10/10 AP 2/2 AMMO 3/3".to_string());

    let (weapon, armor, utilities) = recruit.dismiss();
    utilities.destroy!(|u| u.destroy());
    weapon.destroy_none();
    armor.destroy_none();
    unit.destroy();
}

module ghosts::bench_test;

use ghosts::{
    armor,
    items,
    map,
    recruit::{Self, Recruit},
    stats::{Self, Stats},
    stats_builder,
    weapon
};
use std::unit_test::destroy;
use sui::random;

fun setup(ctx: &mut TxContext): (map::Map, Recruit, Recruit) {
    let id = ctx.fresh_object_address().to_id();
    let mut map = map::demo_1(id);
    let (r1, r3) = (recruit_one(ctx), recruit_two(ctx));
    map.place_recruit(&r1, 6, 5);
    map.place_recruit(&r3, 0, 3);
    (map, r1, r3)
}

fun teardown(map: map::Map, r1: Recruit, r3: Recruit) {
    destroy(vector[r1, r3]);
    let _ = map.destroy();
}

fun do_move(map: &mut map::Map) {
    use grid::direction::{up, left};
    map.move_unit(vector[6, 5, up!(), up!(), left!(), left!(), left!(), left!(), up!()]);
}

#[test]
fun a_baseline() {
    let ctx = &mut tx_context::dummy();
    let (map, r1, r3) = setup(ctx);
    teardown(map, r1, r3);
}

#[test]
fun b_move() {
    let ctx = &mut tx_context::dummy();
    let (mut map, r1, r3) = setup(ctx);
    do_move(&mut map);
    teardown(map, r1, r3);
}

#[test]
fun c_move_shoot() {
    let ctx = &mut tx_context::dummy();
    let (mut map, r1, r3) = setup(ctx);
    do_move(&mut map);
    let mut rng = random::new_generator_from_seed_for_testing(b"bench");
    let _ = map.perform_attack(&mut rng, 3, 1, 0, 3);
    teardown(map, r1, r3);
}

#[test]
fun d_move_grenade() {
    let ctx = &mut tx_context::dummy();
    let (mut map, r1, r3) = setup(ctx);
    do_move(&mut map);
    let mut rng = random::new_generator_from_seed_for_testing(b"bench");
    let _ = map.perform_grenade(&mut rng, 3, 1, 0, 3);
    teardown(map, r1, r3);
}

fun recruit_one(ctx: &mut TxContext): Recruit {
    let mut recruit = recruit::new("Recruit 1", ctx);
    recruit.add_armor(items::armor(2, ctx));
    recruit.add_weapon(items::rifle(3, ctx));
    recruit.add_utility(items::frag_grenade(ctx));
    recruit
}

fun recruit_two(ctx: &mut TxContext): Recruit {
    let mut recruit = recruit::new("Recruit 2", ctx);
    recruit.add_armor(items::armor(2, ctx));
    recruit.add_weapon(items::rifle(2, ctx));
    recruit
}

// === Outcomes ===
//
// Read with `sui move test -s bench_test`: each outcome against the same
// setup, `e_outcome_baseline`, so the difference is what the call costs.
// The attacker at (0, 0) of a 4x4 map shoots or throws at the target at (1, 1).

/// A weapon that always hits for exactly `damage`.
fun sure_shot(damage: u8): Stats {
    stats_builder::new().aim(35).damage(damage).spread(0).crit_chance(0).build_weapon()
}

/// The attacker with `weapon` and a frag grenade, and the target with `armor`,
/// on a 4x4 map.
fun setup_outcome(weapon: Stats, armor: Stats, ctx: &mut TxContext): (map::Map, Recruit, Recruit) {
    let mut map = map::new(ctx.fresh_object_address().to_id(), 4);
    let mut attacker = recruit::default(ctx);
    attacker.add_weapon(weapon::new(b"Test".to_string(), weapon, ctx));
    attacker.add_utility(items::frag_grenade(ctx));
    let mut target = recruit::default(ctx);
    target.add_armor(armor::new(b"Test".to_string(), armor, ctx));
    map.place_recruit(&attacker, 0, 0);
    map.place_recruit(&target, 1, 1);
    (map, attacker, target)
}

/// Shoot from (0, 0) at (1, 1).
fun shoot(weapon: Stats, armor: Stats) {
    let ctx = &mut tx_context::dummy();
    let (mut map, attacker, target) = setup_outcome(weapon, armor, ctx);
    let mut rng = random::new_generator_from_seed_for_testing(b"bench");
    let _ = map.perform_attack(&mut rng, 0, 0, 1, 1);
    teardown(map, attacker, target);
}

/// Throw a grenade from (0, 0) at (1, 1).
fun throw(armor: Stats) {
    let ctx = &mut tx_context::dummy();
    let (mut map, attacker, target) = setup_outcome(sure_shot(1), armor, ctx);
    let mut rng = random::new_generator_from_seed_for_testing(b"bench");
    let _ = map.perform_grenade(&mut rng, 0, 0, 1, 1);
    teardown(map, attacker, target);
}

#[test]
fun e_outcome_baseline() {
    let ctx = &mut tx_context::dummy();
    let (map, attacker, target) = setup_outcome(sure_shot(1), stats::new(0, 0, 0, 0, 0), ctx);
    teardown(map, attacker, target);
}

#[test]
fun f_attack_miss() { shoot(sure_shot(1), stats::new_unchecked(100 << (5 * 8))) }

#[test]
fun g_attack_dodge() { shoot(sure_shot(1), stats::new(0, 0, 0, 0, 100)) }

#[test]
fun h_attack_hit() { shoot(sure_shot(1), stats::new(0, 0, 0, 0, 0)) }

#[test]
fun i_attack_kill() { shoot(sure_shot(99), stats::new(0, 0, 0, 0, 0)) }

#[test]
/// The grenade hits the thrower too: both survive.
fun j_grenade_hit() { throw(stats::new(0, 0, 0, 0, 0)) }

#[test]
/// The target has 4 HP left and falls; the thrower survives.
fun k_grenade_kill() { throw(stats::new(0, 0, 0x80 + 6, 0, 0)) }

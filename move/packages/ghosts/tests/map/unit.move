// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

#[test_only]
extend module ghosts::unit;

use std::unit_test::assert_eq;

/// Put the actions on the unit, after the ones it has, as a utility would.
public fun add_actions_for_testing(unit: &mut Unit, actions: vector<Action>) {
    unit.actions.append(actions);
}

/// A counted `Grenade`.
fun grenade(uses: u8): Action { action::limited(action::new_grenade(), uses) }

/// The first action of the kind with uses left is the one that is spent; the
/// action stays allowed until every one of that kind is spent, then it aborts with
/// the uses error.
#[test, expected_failure(abort_code = ENoUsesLeft)]
fun first_action_with_uses_is_spent() {
    let ctx = &mut tx_context::dummy();
    let recruit = ghosts::recruit::default(ctx);
    let mut unit = from_recruit(&recruit);
    unit.add_actions_for_testing(vector[grenade(1), grenade(2)]);

    // the first one is used up first
    unit.perform_grenade();
    assert_eq!(unit.actions[1].uses(), option::some(0));
    assert_eq!(unit.actions[2].uses(), option::some(2));

    // then the second one, twice
    unit.reset_ap();
    unit.perform_grenade();
    unit.reset_ap();
    unit.perform_grenade();
    assert_eq!(unit.actions[2].uses(), option::some(0));
    assert!(unit.has_action(action::new_grenade()));

    // everything spent: the uses error, not the one for a missing action
    unit.reset_ap();
    unit.perform_grenade();
    abort
}

/// An action with `some(2)` can be performed twice, then aborts.
#[test, expected_failure(abort_code = ENoUsesLeft)]
fun limited_action_runs_out() {
    let ctx = &mut tx_context::dummy();
    let recruit = ghosts::recruit::default(ctx);
    let mut unit = from_recruit(&recruit);
    unit.add_actions_for_testing(vector[grenade(2)]);

    unit.perform_grenade();
    unit.reset_ap();
    unit.perform_grenade();
    unit.reset_ap();
    unit.perform_grenade();
    abort
}

/// Unlimited actions never run out and are never touched: moves, and a
/// grenade without a count.
#[test]
fun unlimited_action_never_runs_out() {
    let ctx = &mut tx_context::dummy();
    let recruit = ghosts::recruit::default(ctx);
    let mut unit = from_recruit(&recruit);
    unit.add_actions_for_testing(vector[action::unlimited(action::new_grenade())]);

    10u8.do!(|_| {
        unit.reset_ap();
        unit.perform_grenade();
        unit.perform_move(1);
    });
    assert_eq!(unit.actions[0].uses(), option::none());
    assert_eq!(unit.actions[1].uses(), option::none());

    recruit.kill(ctx).throw_away();
    unit.destroy();
}

/// A utility modifier is added to the unit's stats, after the armor's.
#[test]
fun utility_stats_modify_the_unit() {
    use ghosts::{stats, utility};

    let ctx = &mut tx_context::dummy();
    let mut recruit = ghosts::recruit::default(ctx);
    let plain = from_recruit(&recruit);
    let bare = plain.stats;
    plain.destroy();

    // +2 armor, +5 dodge, -1 mobility
    let modifier = stats::new(128 + 1, 0, 0, 2, 5);
    recruit.add_utility(utility::new(b"Test".to_string(), modifier, vector[], ctx));
    let unit = from_recruit(&recruit);
    assert_eq!(unit.stats.armor(), bare.armor() + 2);
    assert_eq!(unit.stats.dodge(), bare.dodge() + 5);
    assert_eq!(unit.stats.mobility(), bare.mobility() - 1);
    assert_eq!(unit.stats.aim(), bare.aim());

    recruit.kill(ctx).throw_away();
    unit.destroy();
}

/// The BCS bytes of a unit with counted actions read back the same.
#[test]
fun from_bcs_with_counted_actions() {
    let ctx = &mut tx_context::dummy();
    let recruit = ghosts::recruit::default(ctx);
    let mut unit = from_recruit(&recruit);
    unit.add_actions_for_testing(vector[grenade(1)]);

    let bytes = std::bcs::to_bytes(&unit);
    let restored = from_bytes(bytes);
    assert_eq!(std::bcs::to_bytes(&restored), bytes);
    assert_eq!(restored.actions[1].uses(), option::some(1));

    recruit.kill(ctx).throw_away();
    restored.destroy();
    unit.destroy();
}

// === Effects ===

/// A default recruit's unit with the default weapon: aim 65, range 4.
fun shooter(ctx: &mut TxContext): (ghosts::recruit::Recruit, Unit) {
    let mut recruit = ghosts::recruit::default(ctx);
    let weapon = ghosts::stats::default_weapon();
    recruit.add_weapon(ghosts::weapon::new(b"Test".to_string(), weapon, ctx));
    let unit = from_recruit(&recruit);
    (recruit, unit)
}

/// The hit chance of the unit firing at `range` against `defense`: AP, ammo
/// and uses are given back, so that it can fire again.
fun hit_chance(unit: &mut Unit, range: u8, defense: u8): u8 {
    let mut rng = sui::random::new_generator_from_seed_for_testing(b"hit");
    let (_, _, _, _, chance) = unit.perform_attack(&mut rng, range, defense);
    unit.reset_ap();
    unit.ammo.reset();
    chance
}

#[test]
/// Reapplying a kind refreshes its timer to the larger one, never stacks;
/// another kind is added after it.
fun effects_refresh_and_coexist() {
    let ctx = &mut tx_context::dummy();
    let (recruit, mut unit) = shooter(ctx);

    assert_eq!(unit.apply_effect(effect::new(1, 1)), effect::new(1, 1));
    assert_eq!(unit.apply_effect(effect::daze()), effect::daze());
    // a longer smoke refreshes the timer, a shorter one leaves it
    assert_eq!(unit.apply_effect(effect::smoke()), effect::smoke());
    assert_eq!(unit.apply_effect(effect::new(1, 1)), effect::smoke());
    assert_eq!(unit.effects, vector[effect::smoke(), effect::daze()]);

    recruit.kill(ctx).throw_away();
    unit.destroy();
}

#[test]
/// A tick takes a turn off each effect and drops those at zero, the rest in order.
fun effects_tick_down_and_expire() {
    let ctx = &mut tx_context::dummy();
    let (recruit, mut unit) = shooter(ctx);
    assert_eq!(unit.tick_effects(), vector[]);

    unit.apply_effect(effect::new(0, 1));
    unit.apply_effect(effect::new(1, 2));
    assert_eq!(unit.tick_effects(), vector[effect::new(0, 1).ticked()]);
    assert_eq!(unit.effects, vector[effect::new(1, 1)]);
    assert_eq!(unit.tick_effects(), vector[effect::new(1, 1).ticked()]);
    assert!(unit.effects.is_empty());

    recruit.kill(ctx).throw_away();
    unit.destroy();
}

#[test]
/// Effective stats: smoke takes 30 aim and adds 30 defense, daze takes all aim,
/// daze wins over smoke; base stats never change.
fun effective_stats_follow_effects() {
    let ctx = &mut tx_context::dummy();
    let (recruit, mut unit) = shooter(ctx);
    let base = unit.stats;
    assert_eq!(unit.effective_stats(), base);

    unit.apply_effect(effect::smoke());
    assert_eq!(unit.effective_stats().aim(), base.aim() - 30);
    assert_eq!(unit.effective_stats().defense(), base.defense() + 30);
    assert_eq!(unit.effective_stats().mobility(), base.mobility());

    unit.apply_effect(effect::daze());
    assert_eq!(unit.effective_stats().aim(), 0);
    assert_eq!(unit.effective_stats().defense(), base.defense() + 30);
    assert_eq!(unit.stats, base);

    // daze first, then smoke: the same
    let mut other = from_recruit(&recruit);
    other.apply_effect(effect::daze());
    other.apply_effect(effect::smoke());
    assert_eq!(other.effective_stats(), unit.effective_stats());

    recruit.kill(ctx).throw_away();
    unit.destroy();
    other.destroy();
}

#[test]
/// The hit chance before, during and after effects on the shooter, from aim 65
/// at range 4 with the range-4 weapon: 65 clean, 35 in smoke, 0 dazed, 0 with
/// both, and the distance bonus still on top of aim 0 at range 2: 10.
fun hit_chance_with_shooter_effects() {
    let ctx = &mut tx_context::dummy();
    let (recruit, mut unit) = shooter(ctx);
    assert_eq!(unit.hit_chance(4, 0), 65);
    assert_eq!(unit.hit_chance(4, 20), 45);

    unit.apply_effect(effect::smoke());
    assert_eq!(unit.hit_chance(4, 0), 35);
    assert_eq!(unit.hit_chance(4, 40), 0);
    unit.apply_effect(effect::daze());
    assert_eq!(unit.hit_chance(4, 0), 0);
    assert_eq!(unit.hit_chance(2, 0), 10);
    assert_eq!(unit.hit_chance(5, 0), 0);

    unit.tick_effects();
    unit.tick_effects();
    assert_eq!(unit.hit_chance(4, 0), 65);

    recruit.kill(ctx).throw_away();
    unit.destroy();
}

#[test]
/// A dazed unit can still move and throw: only aim changes.
fun dazed_unit_moves_and_throws() {
    let ctx = &mut tx_context::dummy();
    let (recruit, mut unit) = shooter(ctx);
    unit.add_actions_for_testing(vector[grenade(1)]);
    unit.apply_effect(effect::daze());
    unit.apply_effect(effect::smoke());
    unit.perform_move(7);
    unit.perform_grenade();
    assert_eq!(unit.ap(), 0);

    recruit.kill(ctx).throw_away();
    unit.destroy();
}

#[test]
/// A unit with no, one and two effects reads back the same from its bytes, the
/// effects last, one byte each after a length byte.
fun from_bcs_with_effects() {
    let ctx = &mut tx_context::dummy();
    let (recruit, mut unit) = shooter(ctx);

    let bare = std::bcs::to_bytes(&unit);
    assert_eq!(bare[bare.length() - 1], 0); // no effects: one zero byte
    let restored = from_bytes(bare);
    assert_eq!(std::bcs::to_bytes(&restored), bare);
    restored.destroy();

    unit.apply_effect(effect::daze());
    let one = std::bcs::to_bytes(&unit);
    assert_eq!(one.length(), bare.length() + 1);
    let restored = from_bytes(one);
    assert_eq!(restored.effects, vector[effect::daze()]);
    assert_eq!(std::bcs::to_bytes(&restored), one);
    restored.destroy();

    unit.apply_effect(effect::smoke());
    let two = std::bcs::to_bytes(&unit);
    assert_eq!(two.length(), bare.length() + 2);
    let restored = from_bytes(two);
    assert_eq!(restored.effects, vector[effect::daze(), effect::smoke()]);
    assert_eq!(std::bcs::to_bytes(&restored), two);

    recruit.kill(ctx).throw_away();
    restored.destroy();
    unit.destroy();
}

#[test]
/// `Unit` BCS sizes with 0, 1 and 2 effects, printed for the report.
fun bench_unit_size() {
    let ctx = &mut tx_context::dummy();
    let (recruit, mut unit) = shooter(ctx);
    let zero = std::bcs::to_bytes(&unit).length();
    unit.apply_effect(effect::daze());
    let one = std::bcs::to_bytes(&unit).length();
    unit.apply_effect(effect::smoke());
    let two = std::bcs::to_bytes(&unit).length();
    std::debug::print(&vector[zero, one, two]);

    recruit.kill(ctx).throw_away();
    unit.destroy();
}

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

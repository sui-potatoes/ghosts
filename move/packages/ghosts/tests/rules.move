// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

#[test_only]
extend module ghosts::rules;

use std::unit_test::{assert_eq, destroy};

/// The size of `units` a side.
public fun size_for_testing(self: &Rules, units: u8): Size { self.sizes[self.size_index(units)] }

/// The queue of a size.
public fun queue_for_testing(size: Size): ID { size.queue }

/// Play squads of `size` on `level`, without the cap.
public fun set_level_for_testing(self: &mut Rules, size: u8, level: ID) {
    let i = self.size_index(size);
    self.sizes[i].level = option::some(level);
}

/// The rules as published, with made-up queues, Black Rain's stand-in the level of
/// three.
fun rules_for_testing(ctx: &mut TxContext): (Rules, RulesCap) {
    let three = new_size(3, @3.to_id(), option::some(@0xB1.to_id()));
    let four = new_size(4, @4.to_id(), option::none());
    new(vector[three, four], ctx)
}

/// A unit's three bytes: rifle tier, armor tier, utility kind.
fun unit(weapon: u8, armor: u8, utility: u8): vector<u8> { vector[weapon, armor, utility] }

/// `count` copies of a unit's bytes.
fun squad_of(unit: vector<u8>, count: u64): vector<u8> {
    let mut squad = vector[];
    count.do!(|_| squad.append(unit));
    squad
}

/// The rules start with the economy of the app: prices, unlocks, tiers and
/// budgets, the placement and the lifetimes; three on a level, four on none.
#[test]
fun test_initial_rules() {
    let ctx = &mut tx_context::dummy();
    let (rules, cap) = rules_for_testing(ctx);

    assert_eq!(rules.version(), 1);
    assert_eq!(rules.weapons, vector[item(20, 0), item(40, 1), item(60, 2)]);
    assert_eq!(rules.armor, vector[item(10, 0), item(25, 0), item(45, 2)]);
    assert_eq!(rules.utilities, vector[item(10, 0), item(10, 0), item(10, 0)]);
    let budgets: vector<vector<u64>> = vector[
        vector[125, 165],
        vector[150, 200],
        vector[190, 255],
        vector[240, 320],
    ];
    let minimums = vector[0, 1400, 1650, 1900];
    4u64.do!(|i| {
        assert_eq!(rules.tiers[i].min_rating, minimums[i]);
        assert_eq!(rules.budget(i as u8, 3), budgets[i][0]);
        assert_eq!(rules.budget(i as u8, 4), budgets[i][1]);
    });
    assert_eq!(rules.placement_games, 5);
    assert_eq!(rules.placement_tier, 1);
    assert_eq!(rules.reveal_limit_ms(), 60_000);
    assert_eq!(rules.reset_cooldown_ms(), 604_800_000);
    assert_eq!(rules.size_of(@3.to_id()), 3);
    assert_eq!(rules.size_of(@4.to_id()), 4);
    assert_eq!(rules.level_of(3), @0xB1.to_id());

    destroy(rules);
    destroy(cap);
}

/// The tier of a rating: the highest band it reaches, each one from its lowest
/// rating, to the point.
#[test]
fun test_tier_boundaries() {
    let ctx = &mut tx_context::dummy();
    let (rules, cap) = rules_for_testing(ctx);
    let placed = 5;

    assert_eq!(rules.tier_of(0, placed), 0);
    assert_eq!(rules.tier_of(1399, placed), 0);
    assert_eq!(rules.tier_of(1400, placed), 1);
    assert_eq!(rules.tier_of(1649, placed), 1);
    assert_eq!(rules.tier_of(1650, placed), 2);
    assert_eq!(rules.tier_of(1899, placed), 2);
    assert_eq!(rules.tier_of(1900, placed), 3);
    assert_eq!(rules.tier_of(5000, placed), 3);

    destroy(rules);
    destroy(cap);
}

/// For the first ranked games a player is at least a Contractor, however they
/// lose; above it they are what their rating says. From the fifth game on, the
/// rating alone.
#[test]
fun test_placement_floor() {
    let ctx = &mut tx_context::dummy();
    let (rules, cap) = rules_for_testing(ctx);

    assert_eq!(rules.tier_of(1340, 0), 1);
    assert_eq!(rules.tier_of(0, 4), 1);
    assert_eq!(rules.tier_of(1700, 0), 2);
    assert_eq!(rules.tier_of(1950, 4), 3);
    assert_eq!(rules.tier_of(1340, 5), 0);
    assert_eq!(rules.tier_of(1340, 50), 0);

    destroy(rules);
    destroy(cap);
}

/// Squads that pass: the cheapest, one at a budget to the credit, every utility
/// and none, and the top tier's gear at the top tier.
#[test]
fun test_squads_that_pass() {
    let ctx = &mut tx_context::dummy();
    let (rules, cap) = rules_for_testing(ctx);

    // three Recruits, 90 of a Rookie's 125
    rules.check_squad(3, 0, &squad_of(unit(1, 1, NO_UTILITY), 3));
    // Assault, Assault, Runner: 55 + 55 + 40 = 150, a Contractor's budget exactly
    let mut squad = unit(1, 2, 0);
    squad.append(unit(1, 2, 1));
    squad.append(unit(1, 1, 2));
    rules.check_squad(3, 1, &squad);
    // two Heavies with smoke and two Recruits: 290 of an Elite's 320 for four
    let mut squad = squad_of(unit(3, 3, 2), 2);
    squad.append(squad_of(unit(1, 1, NO_UTILITY), 2));
    rules.check_squad(4, 3, &squad);

    destroy(rules);
    destroy(cap);
}

#[test, expected_failure(abort_code = ESquadSize)]
fun test_squad_too_small_fail() {
    let ctx = &mut tx_context::dummy();
    let (rules, _cap) = rules_for_testing(ctx);
    rules.check_squad(3, 0, &squad_of(unit(1, 1, NO_UTILITY), 2));
    abort
}

#[test, expected_failure(abort_code = ESquadSize)]
fun test_squad_too_large_fail() {
    let ctx = &mut tx_context::dummy();
    let (rules, _cap) = rules_for_testing(ctx);
    rules.check_squad(3, 0, &squad_of(unit(1, 1, NO_UTILITY), 4));
    abort
}

/// A squad is whole units: three bytes each.
#[test, expected_failure(abort_code = ESquadSize)]
fun test_squad_with_a_partial_unit_fail() {
    let ctx = &mut tx_context::dummy();
    let (rules, _cap) = rules_for_testing(ctx);
    let mut squad = squad_of(unit(1, 1, NO_UTILITY), 3);
    squad.pop_back();
    rules.check_squad(3, 0, &squad);
    abort
}

#[test, expected_failure(abort_code = ESquadSize)]
fun test_empty_squad_fail() {
    let ctx = &mut tx_context::dummy();
    let (rules, _cap) = rules_for_testing(ctx);
    rules.check_squad(3, 0, &vector[]);
    abort
}

/// Every unit carries a rifle: tier 0 is none.
#[test, expected_failure(abort_code = EUnknownItem)]
fun test_no_rifle_fail() {
    let ctx = &mut tx_context::dummy();
    let (rules, _cap) = rules_for_testing(ctx);
    rules.check_squad(3, 3, &squad_of(unit(0, 1, NO_UTILITY), 3));
    abort
}

#[test, expected_failure(abort_code = EUnknownItem)]
fun test_unknown_rifle_fail() {
    let ctx = &mut tx_context::dummy();
    let (rules, _cap) = rules_for_testing(ctx);
    rules.check_squad(3, 3, &squad_of(unit(4, 1, NO_UTILITY), 3));
    abort
}

/// And an armor.
#[test, expected_failure(abort_code = EUnknownItem)]
fun test_no_armor_fail() {
    let ctx = &mut tx_context::dummy();
    let (rules, _cap) = rules_for_testing(ctx);
    rules.check_squad(3, 3, &squad_of(unit(1, 0, NO_UTILITY), 3));
    abort
}

#[test, expected_failure(abort_code = EUnknownItem)]
fun test_unknown_utility_fail() {
    let ctx = &mut tx_context::dummy();
    let (rules, _cap) = rules_for_testing(ctx);
    rules.check_squad(3, 3, &squad_of(unit(1, 1, 3), 3));
    abort
}

/// The sharpshooter rifle is a Contractor's, not a Rookie's.
#[test, expected_failure(abort_code = EItemLocked)]
fun test_locked_rifle_fail() {
    let ctx = &mut tx_context::dummy();
    let (rules, _cap) = rules_for_testing(ctx);
    rules.check_squad(3, 0, &squad_of(unit(2, 1, NO_UTILITY), 3));
    abort
}

/// Heavy armor is an Operative's, not a Contractor's.
#[test, expected_failure(abort_code = EItemLocked)]
fun test_locked_armor_fail() {
    let ctx = &mut tx_context::dummy();
    let (rules, _cap) = rules_for_testing(ctx);
    rules.check_squad(3, 1, &squad_of(unit(1, 3, NO_UTILITY), 3));
    abort
}

/// Five credits over a Contractor's 150: a Sniper in medium armor (65), a Sniper
/// (50) and a Runner (40).
#[test, expected_failure(abort_code = EOverBudget)]
fun test_over_budget_fail() {
    let ctx = &mut tx_context::dummy();
    let (rules, _cap) = rules_for_testing(ctx);
    let mut squad = unit(2, 2, NO_UTILITY);
    squad.append(unit(2, 1, NO_UTILITY));
    squad.append(unit(1, 1, 0));
    rules.check_squad(3, 1, &squad);
    abort
}

/// The units are checked in order: the first one's unknown armor before the
/// second one's locked rifle.
#[test, expected_failure(abort_code = EUnknownItem)]
fun test_units_in_order_fail() {
    let ctx = &mut tx_context::dummy();
    let (rules, _cap) = rules_for_testing(ctx);
    let mut squad = unit(1, 9, NO_UTILITY);
    squad.append(unit(3, 1, NO_UTILITY));
    squad.append(unit(1, 1, NO_UTILITY));
    rules.check_squad(3, 0, &squad);
    abort
}

/// A locked item is told before the budget.
#[test, expected_failure(abort_code = EItemLocked)]
fun test_locked_before_budget_fail() {
    let ctx = &mut tx_context::dummy();
    let (rules, _cap) = rules_for_testing(ctx);
    rules.check_squad(3, 0, &squad_of(unit(3, 3, 0), 3));
    abort
}

#[test, expected_failure(abort_code = EWrongQueue)]
fun test_unknown_queue_fail() {
    let ctx = &mut tx_context::dummy();
    let (rules, _cap) = rules_for_testing(ctx);
    rules.size_of(@5.to_id());
    abort
}

/// Four a side have no level yet: there is nothing to queue for.
#[test, expected_failure(abort_code = ENoLevel)]
fun test_size_without_level_fail() {
    let ctx = &mut tx_context::dummy();
    let (rules, _cap) = rules_for_testing(ctx);
    rules.level_of(4);
    abort
}

/// Every write of the cap bumps the version, and does what it says.
#[test]
fun test_admin_writes_bump_the_version() {
    let ctx = &mut tx_context::dummy();
    let (mut rules, cap) = rules_for_testing(ctx);

    // heavy armor up to 50, still an Operative's
    rules.set_item(&cap, ARMOR, 2, 50, 2);
    assert_eq!(rules.version(), 2);
    assert_eq!(rules.armor[2], item(50, 2));

    // the plasma rifle locked for everyone
    rules.set_item(&cap, WEAPON, 2, 60, 4);
    assert_eq!(rules.version(), 3);

    // the Elite tier from 2000, with more for four
    rules.set_tier(&cap, 3, 2000, vector[240, 330]);
    assert_eq!(rules.version(), 4);
    assert_eq!(rules.tier_of(1999, 5), 2);
    assert_eq!(rules.budget(3, 4), 330);

    rules.set_numbers(&cap, 3, 0, 30_000, 86_400_000);
    assert_eq!(rules.version(), 5);
    assert_eq!(rules.tier_of(1300, 0), 0);
    assert_eq!(rules.reveal_limit_ms(), 30_000);
    assert_eq!(rules.reset_cooldown_ms(), 86_400_000);

    rules.set_level_id(&cap, 4, @0xB2.to_id());
    assert_eq!(rules.version(), 6);
    assert_eq!(rules.level_of(4), @0xB2.to_id());

    destroy(rules);
    destroy(cap);
}

#[test, expected_failure(abort_code = EItemLocked)]
fun test_locked_for_everyone_fail() {
    let ctx = &mut tx_context::dummy();
    let (mut rules, cap) = rules_for_testing(ctx);
    rules.set_item(&cap, WEAPON, 2, 60, 4);
    rules.check_squad(3, 3, &squad_of(unit(3, 1, NO_UTILITY), 3));
    abort
}

/// The rules price what the items are, and no more.
#[test, expected_failure(abort_code = EUnknownItem)]
fun test_set_unknown_item_fail() {
    let ctx = &mut tx_context::dummy();
    let (mut rules, cap) = rules_for_testing(ctx);
    rules.set_item(&cap, UTILITY, 3, 10, 0);
    abort
}

#[test, expected_failure(abort_code = EUnknownItem)]
fun test_set_unknown_slot_fail() {
    let ctx = &mut tx_context::dummy();
    let (mut rules, cap) = rules_for_testing(ctx);
    rules.set_item(&cap, 3, 0, 10, 0);
    abort
}

/// The tiers stay in order.
#[test, expected_failure(abort_code = EBadTier)]
fun test_tier_out_of_order_fail() {
    let ctx = &mut tx_context::dummy();
    let (mut rules, cap) = rules_for_testing(ctx);
    rules.set_tier(&cap, 1, 1650, vector[150, 200]);
    abort
}

/// A budget for every size.
#[test, expected_failure(abort_code = EBadTier)]
fun test_tier_without_every_budget_fail() {
    let ctx = &mut tx_context::dummy();
    let (mut rules, cap) = rules_for_testing(ctx);
    rules.set_tier(&cap, 1, 1400, vector[150]);
    abort
}

#[test, expected_failure(abort_code = EBadTier)]
fun test_unknown_placement_tier_fail() {
    let ctx = &mut tx_context::dummy();
    let (mut rules, cap) = rules_for_testing(ctx);
    rules.set_numbers(&cap, 5, 4, 60_000, 0);
    abort
}

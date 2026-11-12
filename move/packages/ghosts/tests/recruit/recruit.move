// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

#[test_only]
extend module ghosts::recruit;

#[test]
fun test_rank_up_and_accessors() {
    use std::unit_test::{assert_eq, assert_ref_eq};

    let ctx = &mut tx_context::dummy();
    let mut recruit = default(ctx);

    assert_ref_eq!(recruit.rank(), &rank::rookie());

    // tests reads on values to increase coverage
    assert_eq!(recruit.leader(), ctx.sender());
    assert_eq!(recruit.stats().aim(), 65); // default value

    recruit.rank_up();

    assert!(&recruit.rank != &rank::rookie());

    let dog_tag = recruit.kill(ctx);
    assert!(dog_tag.rank.is_squaddie());

    dog_tag.throw_away();
}

/// Experience turns into ranks at the set marks, each with its bonus, and stops
/// promoting at the top.
#[test]
fun test_promotions() {
    use std::unit_test::assert_eq;

    let ctx = &mut tx_context::dummy();
    let mut recruit = Self::new("Test", ctx);
    assert_eq!(recruit.stats.aim(), 65);
    assert_eq!(recruit.stats.health(), 10);

    recruit.add_xp(2);
    assert!(recruit.rank.is_rookie());

    recruit.add_xp(1);
    assert!(recruit.rank.is_squaddie());
    assert_eq!(recruit.stats.aim(), 67);
    assert_eq!(recruit.stats.health(), 10);

    recruit.add_xp(5);
    assert!(recruit.rank.is_corporal());
    assert_eq!(recruit.stats.aim(), 69);
    assert_eq!(recruit.stats.health(), 11);

    // several ranks at once, and past the last one
    recruit.add_xp(1000);
    assert!(recruit.rank.is_colonel());
    assert_eq!(recruit.stats.aim(), 79);
    assert_eq!(recruit.stats.health(), 13);
    assert_eq!(recruit.xp, 1008);

    recruit.kill(ctx).throw_away();
}

/// Utilities are capped by the slots, taken off by ID, and go down with the recruit.
#[test]
fun test_utilities() {
    use std::unit_test::assert_eq;

    let ctx = &mut tx_context::dummy();
    let mut recruit = Self::new("Test", ctx);
    assert_eq!(MAX_UTILITIES, 1);
    assert!(recruit.utilities().is_empty());

    let grenade = ghosts::items::frag_grenade(ctx);
    let id = object::id(&grenade);
    recruit.add_utility(grenade);
    assert_eq!(recruit.utilities().length(), 1);
    recruit.remove_utility(id).destroy();

    // dismissed with the gear returned
    recruit.add_utility(ghosts::items::frag_grenade(ctx));
    let (weapon, armor, utilities) = recruit.dismiss();
    assert_eq!(utilities.length(), 1);
    weapon.destroy_none();
    armor.destroy_none();
    utilities.destroy!(|u| u.destroy());

    // killed with the gear gone
    let mut recruit = Self::new("Test", ctx);
    recruit.add_utility(ghosts::items::frag_grenade(ctx));
    recruit.kill(ctx).throw_away();
}

#[test, expected_failure(abort_code = EUtilitiesFull)]
fun test_utilities_full_fail() {
    let ctx = &mut tx_context::dummy();
    let mut recruit = Self::new("Test", ctx);
    recruit.add_utility(ghosts::items::frag_grenade(ctx));
    recruit.add_utility(ghosts::items::frag_grenade(ctx));
    abort
}

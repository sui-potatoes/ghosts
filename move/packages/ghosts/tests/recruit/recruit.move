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

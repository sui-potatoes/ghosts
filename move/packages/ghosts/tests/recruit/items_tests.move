// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/// Contains all definitions for items that can be used by `Recruits`.
module ghosts::items_tests;

use ghosts::items;
use std::unit_test::assert_eq;

#[test]
fun test_weapons() {
    let ctx = &mut tx_context::dummy();

    {
        let rifle = items::rifle(1, ctx);
        assert_eq!(rifle.stats().damage(), 4);
        assert_eq!(rifle.stats().spread(), 2);
        assert_eq!(rifle.stats().plus_one(), 10);
        assert_eq!(rifle.stats().crit_chance(), 10);
        assert_eq!(rifle.stats().can_be_dodged(), 1);
        assert_eq!(rifle.stats().area_size(), 0);
        assert_eq!(rifle.stats().env_damage(), 0);
        assert_eq!(rifle.stats().range(), 4);
        assert_eq!(rifle.stats().ammo(), 3);
        rifle.destroy();
    };

    {
        let rifle = items::rifle(2, ctx);
        assert_eq!(rifle.stats().damage(), 5);
        assert_eq!(rifle.stats().spread(), 1);
        assert_eq!(rifle.stats().plus_one(), 20);
        assert_eq!(rifle.stats().crit_chance(), 20);
        assert_eq!(rifle.stats().can_be_dodged(), 1);
        assert_eq!(rifle.stats().area_size(), 0);
        assert_eq!(rifle.stats().env_damage(), 0);
        assert_eq!(rifle.stats().range(), 5);
        assert_eq!(rifle.stats().ammo(), 3);
        rifle.destroy();
    };

    {
        let rifle = items::rifle(3, ctx);
        assert_eq!(rifle.stats().damage(), 6);
        assert_eq!(rifle.stats().spread(), 1);
        assert_eq!(rifle.stats().plus_one(), 30);
        assert_eq!(rifle.stats().crit_chance(), 30);
        assert_eq!(rifle.stats().can_be_dodged(), 1);
        assert_eq!(rifle.stats().area_size(), 0);
        assert_eq!(rifle.stats().env_damage(), 0);
        assert_eq!(rifle.stats().range(), 5);
        assert_eq!(rifle.stats().ammo(), 3);
        rifle.destroy();
    };
}

#[test]
/// The frag grenade is the old base grenade as an item: a `Grenade` action with one
/// use, and no stats of its own.
fun test_utilities() {
    use ghosts::action;

    let ctx = &mut tx_context::dummy();
    let grenade = items::utility(0, ctx);
    assert_eq!(grenade.name(), b"Frag Grenade".to_string());
    assert_eq!(*grenade.actions(), vector[action::limited(action::new_grenade(), 1)]);
    // it adds nothing to its carrier: the zero modifier
    assert_eq!(grenade.stats().inner(), 0);
    assert!(items::is_utility(0));
    assert!(!items::is_utility(3));
    grenade.destroy();
}

#[test]
/// The flashbang and the smoke grenade are utilities like the frag grenade: each
/// its own action with one use, and no stats of their own.
fun test_effect_grenades() {
    use ghosts::action;

    let ctx = &mut tx_context::dummy();
    let flashbang = items::utility(1, ctx);
    assert_eq!(flashbang.name(), b"Flashbang".to_string());
    assert_eq!(*flashbang.actions(), vector[action::limited(action::new_flashbang(), 1)]);
    assert_eq!(flashbang.stats().inner(), 0);

    let smoke = items::utility(2, ctx);
    assert_eq!(smoke.name(), b"Smoke Grenade".to_string());
    assert_eq!(*smoke.actions(), vector[action::limited(action::new_smoke_grenade(), 1)]);
    assert_eq!(smoke.stats().inner(), 0);

    assert!(items::is_utility(1) && items::is_utility(2));
    flashbang.destroy();
    smoke.destroy();
}

#[test, expected_failure]
fun test_unknown_utility_fail() {
    let ctx = &mut tx_context::dummy();
    items::utility(3, ctx).destroy();
}

#[test]
fun test_armor() {
    let ctx = &mut tx_context::dummy();

    {
        let armor = items::armor(1, ctx);
        assert_eq!(armor.stats().armor(), 1);
        assert_eq!(armor.stats().dodge(), 10);
        armor.destroy();
    };

    {
        let armor = items::armor(2, ctx);
        assert_eq!(armor.stats().armor(), 2);
        assert_eq!(armor.stats().dodge(), 0);
        armor.destroy();
    };

    {
        let armor = items::armor(3, ctx);
        assert_eq!(armor.stats().mobility(), 0x80 + 1);
        assert_eq!(armor.stats().health(), 1);
        assert_eq!(armor.stats().armor(), 3);
        assert_eq!(armor.stats().dodge(), 0x80 + 10);
        armor.destroy();
    };
}

#[test]
fun test_weapon_upgrades() {
    let ctx = &mut tx_context::dummy();
    let mut rifle = items::rifle(1, ctx);

    assert_eq!(rifle.stats().aim(), 0);

    // scope 1
    rifle.add_upgrade(items::scope(1, ctx));
    assert_eq!(rifle.stats().aim(), 5);
    rifle.remove_upgrade(0).destroy();
    assert_eq!(rifle.stats().aim(), 0);

    // scope 2
    rifle.add_upgrade(items::scope(2, ctx));
    assert_eq!(rifle.stats().aim(), 10);
    rifle.remove_upgrade(0).destroy();
    assert_eq!(rifle.stats().aim(), 0);

    // scope 3
    rifle.add_upgrade(items::scope(3, ctx));
    assert_eq!(rifle.stats().aim(), 15);
    rifle.remove_upgrade(0).destroy();
    assert_eq!(rifle.stats().aim(), 0);

    assert_eq!(rifle.stats().crit_chance(), 10);

    // laser sight 1
    rifle.add_upgrade(items::laser_sight(1, ctx));
    assert_eq!(rifle.stats().crit_chance(), 15);
    rifle.remove_upgrade(0).destroy();
    assert_eq!(rifle.stats().crit_chance(), 10);

    // laser sight 2
    rifle.add_upgrade(items::laser_sight(2, ctx));
    assert_eq!(rifle.stats().crit_chance(), 20);
    rifle.remove_upgrade(0).destroy();
    assert_eq!(rifle.stats().crit_chance(), 10);

    // laser sight 3
    rifle.add_upgrade(items::laser_sight(3, ctx));
    assert_eq!(rifle.stats().crit_chance(), 25);
    rifle.remove_upgrade(0).destroy();
    assert_eq!(rifle.stats().crit_chance(), 10);

    // stock 1
    rifle.add_upgrade(items::stock(1, ctx));
    assert_eq!(rifle.stats().range(), 5);
    rifle.remove_upgrade(0).destroy();
    assert_eq!(rifle.stats().range(), 4);

    // stock 2
    rifle.add_upgrade(items::stock(2, ctx));
    assert_eq!(rifle.stats().range(), 6);
    rifle.remove_upgrade(0).destroy();
    assert_eq!(rifle.stats().range(), 4);

    // stock 3
    rifle.add_upgrade(items::stock(3, ctx));
    assert_eq!(rifle.stats().range(), 7);
    rifle.remove_upgrade(0).destroy();
    assert_eq!(rifle.stats().range(), 4);

    // expanded clip 1
    rifle.add_upgrade(items::expanded_clip(1, ctx));
    assert_eq!(rifle.stats().ammo(), 4);
    rifle.remove_upgrade(0).destroy();
    assert_eq!(rifle.stats().ammo(), 3);

    // expanded clip 2
    rifle.add_upgrade(items::expanded_clip(2, ctx));
    assert_eq!(rifle.stats().ammo(), 5);
    rifle.remove_upgrade(0).destroy();
    assert_eq!(rifle.stats().ammo(), 3);

    // expanded clip 3
    rifle.add_upgrade(items::expanded_clip(3, ctx));
    assert_eq!(rifle.stats().ammo(), 6);
    rifle.remove_upgrade(0).destroy();
    assert_eq!(rifle.stats().ammo(), 3);

    rifle.destroy();
}

#[test]
fun test_weapon_upgrade_kinds() {
    let ctx = &mut tx_context::dummy();
    let mut rifle = items::rifle(1, ctx);

    rifle.add_upgrade(items::scope(1, ctx));
    rifle.add_upgrade(items::stock(2, ctx));
    rifle.add_upgrade(items::expanded_clip(3, ctx));
    assert_eq!(rifle.upgrades().length(), 3);

    // a kind frees up once its upgrade comes off
    rifle.remove_upgrade(0).destroy();
    rifle.add_upgrade(items::scope(3, ctx));
    assert_eq!(rifle.stats().aim(), 15);

    rifle.destroy();
}

#[test, expected_failure(abort_code = ghosts::weapon::EUpgradeKindTaken)]
fun test_weapon_upgrade_kind_taken() {
    let ctx = &mut tx_context::dummy();
    let mut rifle = items::rifle(1, ctx);

    rifle.add_upgrade(items::laser_sight(1, ctx));
    rifle.add_upgrade(items::laser_sight(2, ctx));

    abort
}

#[test, expected_failure(abort_code = ghosts::weapon::ETooManyUpgrades)]
fun test_weapon_upgrade_limit() {
    let ctx = &mut tx_context::dummy();
    let mut rifle = items::rifle(1, ctx);

    rifle.add_upgrade(items::scope(1, ctx));
    rifle.add_upgrade(items::laser_sight(1, ctx));
    rifle.add_upgrade(items::stock(1, ctx));
    rifle.add_upgrade(items::expanded_clip(1, ctx));

    abort
}

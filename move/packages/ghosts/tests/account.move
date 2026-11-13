// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

#[test_only]
extend module ghosts::account;

use sui::test_scenario as ts;

/// What was last sent to the `Account` of this type.
fun last_sent<T: key>(acc: &Account): Receiving<T> {
    ts::most_recent_receiving_ticket<T>(&object::id(acc))
}

#[test]
fun test_account_lifecycle() {
    use std::unit_test::assert_eq;

    let user = @0xA11CE;
    let mut ts = ts::begin(user);
    init_for_testing(ts.ctx());

    // create an account for the user
    ts.next_tx(user);
    let mut registry = ts.take_shared<Registry>();
    new_account(&mut registry, ts.ctx());

    ts.next_tx(user);
    let mut acc = ts.take_shared<Account>();
    assert_eq!(acc.owner(), user);
    assert_eq!(acc.rating(), glicko::default());
    assert!(acc.is_idle());
    assert!(registry.has_account(user));
    assert_eq!(registry.account_of(user), object::id(&acc));

    // hire a recruit, stash gear: it is all sent to the account
    let home = object::id_address(&acc);
    let recruit_id = acc.add_test_recruit(ts.ctx());
    transfer::public_transfer(acc.requisition_rifle(1, ts.ctx()), home);
    transfer::public_transfer(acc.requisition_upgrade(0, 1, ts.ctx()), home);
    assert_eq!(acc.num_recruits(), 1);

    // in one go: customize the recruit (the name stays), fit the scope to the
    // rifle and arm the recruit with it
    ts.next_tx(user);
    let (mut jane, borrow) = acc.borrow_recruit(ts::receiving_ticket_by_id(recruit_id), ts.ctx());
    edit_recruit(&mut jane, vector[1, 2], vector[3], vector[4, 5], vector[6], vector[7], 1);
    let (rifle, scope) = (last_sent(&acc), last_sent(&acc));
    let mut rifle = acc.take_weapon(rifle, ts.ctx());
    let rifle_id = object::id(&rifle);
    rifle.add_upgrade(acc.take_upgrade(scope, ts.ctx()));
    equip_weapon(&mut jane, rifle);
    assert!(jane.weapon().is_some());

    // change of heart: the rifle goes back to the armory
    transfer::public_transfer(unequip_weapon(&mut jane), home);
    return_recruit(jane, borrow);

    // and the scope back on the shelf
    ts.next_tx(user);
    let mut rifle = acc.take_weapon(ts::receiving_ticket_by_id(rifle_id), ts.ctx());
    transfer::public_transfer(rifle.remove_upgrade(0), home);
    assert_eq!(rifle.upgrades().length(), 0);
    transfer::public_transfer(rifle, home);

    // the recruit falls in battle; their dog tag is sent home
    let recruit = acc.remove_recruit(ts::receiving_ticket_by_id(recruit_id), ts.ctx());
    transfer::public_transfer(recruit.kill(ts.ctx()), object::id_address(&acc));
    assert_eq!(acc.num_recruits(), 0);

    ts.next_tx(user);
    let sent = last_sent(&acc);
    acc.take_dog_tag(sent, ts.ctx()).throw_away();
    assert_eq!(ts::ids_for_address<WeaponUpgrade>(home).length(), 1);

    ts::return_shared(registry);
    ts::return_shared(acc);
    ts.end();
}

/// A recruit as the tests hire one, sent to the `Account`.
fun add_test_recruit(acc: &mut Account, ctx: &mut TxContext): ID {
    let recruit = recruit::new("Jane Doe", ctx);
    let id = object::id(&recruit);
    acc.add_recruit(recruit);
    id
}

#[test]
fun test_hire_recruits() {
    use std::unit_test::assert_eq;

    let user = @0xA11CE;
    let mut ts = ts::begin(user);
    init_for_testing(ts.ctx());

    // `Random` can only be created by the system address
    ts.next_tx(@0);
    sui::random::create_for_testing(ts.ctx());

    ts.next_tx(user);
    let mut registry = ts.take_shared<Registry>();
    let rng = ts.take_shared<Random>();
    new_account(&mut registry, ts.ctx());

    ts.next_tx(user);
    let mut acc = ts.take_shared<Account>();

    // deposit one recruit manually, then top the squad up to the free limit
    let recruit_id = acc.add_test_recruit(ts.ctx());
    acc.hire_recruits(&registry, &rng, ts.ctx());
    assert_eq!(acc.num_recruits(), FREE_RECRUITS);

    // the looks hires are mixed from: 16 + 16 presets, five areas, codec version 1
    assert_eq!(registry.visual_presets.length(), 2 * PRESETS_PER_GENDER);
    registry.visual_presets.do_ref!(|preset| {
        assert_eq!(preset.length(), 5);
        assert_eq!(preset[0] & 0xff, 1);
    });

    // every recruit is owned by the account, which leads them
    let home = object::id_address(&acc);
    ts.next_tx(user);
    let owned = ts::ids_for_address<Recruit>(home);
    assert_eq!(owned.length(), FREE_RECRUITS);
    let jane = ts.take_from_address_by_id<Recruit>(home, recruit_id);
    assert_eq!(jane.leader(), home);
    ts::return_to_address(home, jane);

    ts::return_shared(registry);
    ts::return_shared(rng);
    ts::return_shared(acc);
    ts.end();
}

#[test]
fun test_dismiss_recruit() {
    use std::unit_test::assert_eq;

    let user = @0xA11CE;
    let mut ts = ts::begin(user);
    init_for_testing(ts.ctx());

    ts.next_tx(@0);
    sui::random::create_for_testing(ts.ctx());

    ts.next_tx(user);
    let mut registry = ts.take_shared<Registry>();
    let rng = ts.take_shared<Random>();
    new_account(&mut registry, ts.ctx());

    ts.next_tx(user);
    let mut acc = ts.take_shared<Account>();
    let recruit_id = acc.add_test_recruit(ts.ctx());

    // arm the recruit with a modded rifle and armor, then let them go
    let mut rifle = items::rifle(1, ts.ctx());
    let rifle_id = object::id(&rifle);
    rifle.add_upgrade(items::scope(1, ts.ctx()));
    let armor = items::armor(1, ts.ctx());
    let armor_id = object::id(&armor);
    let grenade = items::frag_grenade(ts.ctx());
    let grenade_id = object::id(&grenade);
    ts.next_tx(user);
    let (mut jane, borrow) = acc.borrow_recruit(ts::receiving_ticket_by_id(recruit_id), ts.ctx());
    equip_weapon(&mut jane, rifle);
    equip_armor(&mut jane, armor);
    equip_utility(&mut jane, grenade);
    return_recruit(jane, borrow);

    ts.next_tx(user);
    acc.dismiss_recruit(ts::receiving_ticket_by_id(recruit_id), ts.ctx());
    assert_eq!(acc.num_recruits(), 0);

    // every piece is back in the armory, the rifle with its mod still fitted
    let home = object::id_address(&acc);
    ts.next_tx(user);
    let rifle = ts.take_from_address_by_id<Weapon>(home, rifle_id);
    assert_eq!(rifle.upgrades().length(), 1);
    ts::return_to_address(home, rifle);
    assert!(ts::ids_for_address<Armor>(home).contains(&armor_id));
    assert!(ts::ids_for_address<Utility>(home).contains(&grenade_id));
    assert!(ts::ids_for_address<Recruit>(home).is_empty());

    // the freed slot hires again
    acc.hire_recruits(&registry, &rng, ts.ctx());
    assert_eq!(acc.num_recruits(), FREE_RECRUITS);

    ts::return_shared(registry);
    ts::return_shared(rng);
    ts::return_shared(acc);
    ts.end();
}

/// A recruit goes back to the `Account` it was borrowed from, and only for its own `Borrow`.
#[test, expected_failure(abort_code = EWrongRecruit)]
fun test_return_another_recruit_fail() {
    let mut ts = ts::begin(@0);
    let (_registry, mut acc, _rng) = open_account(&mut ts);
    let first = acc.add_test_recruit(ts.ctx());
    let second = acc.add_test_recruit(ts.ctx());

    ts.next_tx(@1);
    let (_jane, borrow) = acc.borrow_recruit(ts::receiving_ticket_by_id(first), ts.ctx());
    let (john, _borrow) = acc.borrow_recruit(ts::receiving_ticket_by_id(second), ts.ctx());
    return_recruit(john, borrow);

    abort
}

#[test, expected_failure(abort_code = ERecruitLimitReached)]
fun test_hire_recruits_full_squad_fail() {
    let user = @0xA11CE;
    let mut ts = ts::begin(user);
    init_for_testing(ts.ctx());

    // `Random` can only be created by the system address
    ts.next_tx(@0);
    sui::random::create_for_testing(ts.ctx());

    ts.next_tx(user);
    let mut registry = ts.take_shared<Registry>();
    let rng = ts.take_shared<Random>();
    new_account(&mut registry, ts.ctx());

    ts.next_tx(user);
    let mut acc = ts.take_shared<Account>();
    acc.hire_recruits(&registry, &rng, ts.ctx());
    acc.hire_recruits(&registry, &rng, ts.ctx()); // squad is already full - aborts

    abort
}

#[test, expected_failure(abort_code = EInGame)]
/// Recruits on a map are not in the `Account`: no topping up for free meanwhile.
fun test_hire_recruits_in_game_fail() {
    let user = @0xA11CE;
    let mut ts = ts::begin(user);
    init_for_testing(ts.ctx());

    ts.next_tx(@0);
    sui::random::create_for_testing(ts.ctx());

    ts.next_tx(user);
    let mut registry = ts.take_shared<Registry>();
    let rng = ts.take_shared<Random>();
    new_account(&mut registry, ts.ctx());

    ts.next_tx(user);
    let mut acc = ts.take_shared<Account>();
    acc.state = State::Playing(@1.to_id());
    acc.hire_recruits(&registry, &rng, ts.ctx());

    abort
}

#[test, expected_failure(abort_code = EInvalidVoice)]
fun test_edit_recruit_invalid_voice_fail() {
    let mut ts = ts::begin(@0);
    let mut recruit = recruit::new("Jane Doe", ts.ctx());
    edit_recruit(&mut recruit, vector[], vector[], vector[], vector[], vector[], NUM_VOICES);

    abort
}

#[test, expected_failure(abort_code = EAccountExists)]
fun test_duplicate_account_fail() {
    let user = @0xA11CE;
    let mut ts = ts::begin(user);
    init_for_testing(ts.ctx());

    ts.next_tx(user);
    let mut registry = ts.take_shared<Registry>();
    new_account(&mut registry, ts.ctx());
    new_account(&mut registry, ts.ctx());

    abort
}

#[test, expected_failure(abort_code = ENotOwner)]
fun test_not_owner_fail() {
    let (user, thief) = (@0xA11CE, @0xB0B);
    let mut ts = ts::begin(user);
    init_for_testing(ts.ctx());

    ts.next_tx(user);
    let mut registry = ts.take_shared<Registry>();
    new_account(&mut registry, ts.ctx());

    // another party attempts to use the account
    ts.next_tx(thief);
    let acc = ts.take_shared<Account>();
    let _upgrade = acc.requisition_upgrade(0, 1, ts.ctx());

    abort
}

/// Nobody but the owner takes a recruit out of an `Account`.
#[test, expected_failure(abort_code = ENotOwner)]
fun test_borrow_not_owner_fail() {
    let mut ts = ts::begin(@0);
    let (_registry, mut acc, _rng) = open_account(&mut ts);
    let id = acc.add_test_recruit(ts.ctx());

    ts.next_tx(@2);
    let (_recruit, _borrow) = acc.borrow_recruit(ts::receiving_ticket_by_id(id), ts.ctx());

    abort
}

/// A fresh `Account` in a transaction of its owner, and what it takes to hire.
fun open_account(ts: &mut ts::Scenario): (Registry, Account, Random) {
    init_for_testing(ts.ctx());
    sui::random::create_for_testing(ts.ctx());
    ts.next_tx(@1);
    let mut registry = ts.take_shared<Registry>();
    let rng = ts.take_shared<Random>();
    registry.new_account(ts.ctx());
    ts.next_tx(@1);
    let acc = ts.take_shared<Account>();
    (registry, acc, rng)
}

fun close_account(ts: ts::Scenario, registry: Registry, acc: Account, rng: Random) {
    ts::return_shared(registry);
    ts::return_shared(acc);
    ts::return_shared(rng);
    ts.end();
}

/// Four come as a squad, and the rest one at a time, up to the limit.
#[test]
fun test_hire_past_the_free_squad() {
    use std::unit_test::assert_eq;

    let mut ts = ts::begin(@0);
    let (registry, mut acc, rng) = open_account(&mut ts);

    acc.hire_recruits(&registry, &rng, ts.ctx());
    assert_eq!(acc.num_recruits(), FREE_RECRUITS);

    (MAX_RECRUITS - FREE_RECRUITS).do!(|_| acc.hire_recruit(&registry, &rng, ts.ctx()));
    assert_eq!(acc.num_recruits(), MAX_RECRUITS);

    close_account(ts, registry, acc, rng);
}

#[test, expected_failure(abort_code = ERecruitLimitReached)]
fun test_hire_past_the_limit_fail() {
    let mut ts = ts::begin(@0);
    let (registry, mut acc, rng) = open_account(&mut ts);
    (MAX_RECRUITS + 1).do!(|_| acc.hire_recruit(&registry, &rng, ts.ctx()));

    abort
}

/// Requisitioned gear is the player's, for a recruit or the armory.
#[test]
fun test_requisition_gear() {
    use std::unit_test::assert_eq;

    let mut ts = ts::begin(@0);
    let (registry, acc, rng) = open_account(&mut ts);

    let rifle = acc.requisition_rifle(2, ts.ctx());
    assert!(rifle.required_rank().is_corporal());
    let armor = acc.requisition_armor(1, ts.ctx());
    assert!(armor.required_rank().is_rookie());
    let scope = acc.requisition_upgrade(0, 3, ts.ctx());
    assert_eq!(scope.tier(), 3);

    let home = object::id_address(&acc);
    transfer::public_transfer(rifle, home);
    transfer::public_transfer(armor, home);
    transfer::public_transfer(scope, home);
    ts.next_tx(@1);
    assert_eq!(ts::ids_for_address<Weapon>(home).length(), 1);
    assert_eq!(ts::ids_for_address<Armor>(home).length(), 1);
    assert_eq!(ts::ids_for_address<WeaponUpgrade>(home).length(), 1);

    close_account(ts, registry, acc, rng);
}

/// Gear moves from one recruit to another in one go: off the first one, onto the
/// second, whose own piece goes to the armory.
#[test]
fun test_hand_gear_over() {
    use std::unit_test::assert_eq;

    let mut ts = ts::begin(@0);
    let (registry, mut acc, rng) = open_account(&mut ts);
    let mut first = recruit::new("First", ts.ctx());
    first.add_weapon(items::rifle(1, ts.ctx()));
    let rifle = object::id(first.weapon().borrow());
    let (first_id, second_id) = (object::id(&first), acc.add_test_recruit(ts.ctx()));
    acc.add_recruit(first);

    ts.next_tx(@1);
    let (mut second, second_borrow) = acc.borrow_recruit(
        ts::receiving_ticket_by_id(second_id),
        ts.ctx(),
    );
    second.add_weapon(items::rifle(1, ts.ctx()));
    let spare = object::id(second.weapon().borrow());
    let (mut first, first_borrow) = acc.borrow_recruit(
        ts::receiving_ticket_by_id(first_id),
        ts.ctx(),
    );
    equip_weapon(&mut second, unequip_weapon(&mut first));
    assert_eq!(object::id(second.weapon().borrow()), rifle);
    return_recruit(first, first_borrow);
    return_recruit(second, second_borrow);

    ts.next_tx(@1);
    assert_eq!(ts::ids_for_address<Weapon>(object::id_address(&acc)), vector[spare]);

    close_account(ts, registry, acc, rng);
}

/// A rookie can't be issued a Plasma Rifle until they've earned the rank for it.
#[test]
fun test_equip_needs_the_rank() {
    use std::unit_test::assert_eq;

    let mut ts = ts::begin(@0);
    let mut recruit = recruit::new("Test", ts.ctx());

    // standard gear is for anyone
    equip_weapon(&mut recruit, items::rifle(1, ts.ctx()));
    unequip_weapon(&mut recruit).destroy();

    // enough experience for a Lieutenant, and the Plasma Rifle goes on
    let rifle = items::rifle(3, ts.ctx());
    let plasma = object::id(&rifle);
    recruit.add_xp(25);
    assert!(recruit.rank().is_lieutenant());
    equip_weapon(&mut recruit, rifle);
    assert_eq!(object::id(recruit.weapon().borrow()), plasma);

    let (weapon, armor, utilities) = recruit.dismiss();
    utilities.destroy!(|u| u.destroy());
    weapon.destroy!(|w| w.destroy());
    armor.destroy_none();
    ts.end();
}

#[test, expected_failure(abort_code = ERankTooLow)]
fun test_equip_weapon_below_rank_fail() {
    let mut ts = ts::begin(@0);
    let mut recruit = recruit::new("Test", ts.ctx());
    equip_weapon(&mut recruit, items::rifle(2, ts.ctx()));

    abort
}

#[test, expected_failure(abort_code = ERankTooLow)]
fun test_equip_armor_below_rank_fail() {
    let mut ts = ts::begin(@0);
    let mut recruit = recruit::new("Test", ts.ctx());
    equip_armor(&mut recruit, items::armor(3, ts.ctx()));

    abort
}

/// A utility is requisitioned, fitted to a recruit, taken off by its ID and sent
/// back to the armory; a recruit past their slots can't carry another.
#[test]
fun test_requisition_equip_unequip_utility() {
    use std::unit_test::assert_eq;

    let mut ts = ts::begin(@0);
    let (registry, acc, rng) = open_account(&mut ts);
    let mut recruit = recruit::new("Test", ts.ctx());

    let grenade = acc.requisition_utility(0, ts.ctx());
    assert_eq!(grenade.name(), b"Frag Grenade".to_string());
    let id = object::id(&grenade);
    equip_utility(&mut recruit, grenade);
    assert_eq!(recruit.utilities().length(), 1);

    let grenade = unequip_utility(&mut recruit, id);
    assert!(recruit.utilities().is_empty());
    let home = object::id_address(&acc);
    transfer::public_transfer(grenade, home);
    transfer::public_transfer(recruit, home);
    ts.next_tx(@1);
    assert_eq!(ts::ids_for_address<Utility>(home), vector[id]);

    close_account(ts, registry, acc, rng);
}

/// Nobody but the owner requisitions a utility.
#[test, expected_failure(abort_code = ENotOwner)]
fun test_requisition_utility_not_owner_fail() {
    let mut ts = ts::begin(@0);
    let (_registry, acc, _rng) = open_account(&mut ts);

    ts.next_tx(@2);
    let _grenade = acc.requisition_utility(0, ts.ctx());
    abort
}

#[test, expected_failure(abort_code = EUnknownUtility)]
fun test_requisition_unknown_utility_fail() {
    let mut ts = ts::begin(@0);
    let (_registry, acc, _rng) = open_account(&mut ts);
    let _utility = acc.requisition_utility(1, ts.ctx());
    abort
}

/// Fitting a second utility to a recruit with one slot aborts.
#[test, expected_failure(abort_code = ghosts::recruit::EUtilitiesFull)]
fun test_equip_second_utility_fail() {
    let mut ts = ts::begin(@0);
    let mut recruit = recruit::new("Test", ts.ctx());
    equip_utility(&mut recruit, items::frag_grenade(ts.ctx()));
    equip_utility(&mut recruit, items::frag_grenade(ts.ctx()));
    abort
}

/// Taking off a utility the recruit does not carry aborts.
#[test, expected_failure(abort_code = ghosts::recruit::ENoUtility)]
fun test_unequip_missing_utility_fail() {
    let mut ts = ts::begin(@0);
    let mut recruit = recruit::new("Test", ts.ctx());
    let _utility = unequip_utility(&mut recruit, object::id_from_address(@0x1));
    abort
}

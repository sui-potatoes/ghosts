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

    // the hires carry a Standard Rifle, the very one `requisition_rifle` gives,
    // and nothing else; the armory is still empty
    let standard = acc.requisition_rifle(1, ts.ctx());
    owned.do!(|id| {
        if (id == recruit_id) return;
        let hire = ts.take_from_address_by_id<Recruit>(home, id);
        let rifle = hire.weapon().borrow();
        assert_eq!(rifle.name(), b"Standard Rifle".to_string());
        assert_eq!(rifle.name(), standard.name());
        assert!(rifle.stats() == standard.stats());
        assert!(rifle.upgrades().is_empty());
        assert!(hire.armor().is_none());
        assert!(hire.utilities().is_empty());
        ts::return_to_address(home, hire);
    });
    standard.destroy();
    assert!(ts::ids_for_address<Weapon>(home).is_empty());

    ts::return_shared(registry);
    ts::return_shared(rng);
    ts::return_shared(acc);
    ts.end();
}

/// A hire's rifle is gear like any other: unequipped, it goes to the armory and
/// leaves the recruit unarmed; dismissed, the recruit leaves it there too.
#[test]
fun test_hired_rifle_to_armory() {
    use std::unit_test::assert_eq;

    let mut ts = ts::begin(@0);
    let (registry, mut acc, rng) = open_account(&mut ts);
    acc.hire_recruits(&registry, &rng, ts.ctx());

    let home = object::id_address(&acc);
    ts.next_tx(@1);
    let hires = ts::ids_for_address<Recruit>(home);
    let (mut first, borrow) = acc.borrow_recruit(ts::receiving_ticket_by_id(hires[0]), ts.ctx());
    let rifle = unequip_weapon(&mut first);
    let rifle_id = object::id(&rifle);
    assert!(first.weapon().is_none());
    transfer::public_transfer(rifle, home);
    return_recruit(first, borrow);

    ts.next_tx(@1);
    assert_eq!(ts::ids_for_address<Weapon>(home), vector[rifle_id]);
    let first = ts.take_from_address_by_id<Recruit>(home, hires[0]);
    assert!(first.weapon().is_none());
    ts::return_to_address(home, first);

    // the second hire is dismissed armed: their rifle joins the first one, and
    // the squad tops up with another armed hire
    let second = ts.take_from_address_by_id<Recruit>(home, hires[1]);
    let second_rifle = object::id(second.weapon().borrow());
    ts::return_to_address(home, second);
    acc.dismiss_recruit(ts::receiving_ticket_by_id(hires[1]), ts.ctx());
    acc.hire_recruits(&registry, &rng, ts.ctx());
    assert_eq!(acc.num_recruits(), FREE_RECRUITS);

    ts.next_tx(@1);
    let armory = ts::ids_for_address<Weapon>(home);
    assert_eq!(armory.length(), 2);
    assert!(armory.contains(&rifle_id) && armory.contains(&second_rifle));

    close_account(ts, registry, acc, rng);
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

/// Requisitioned gear is the player's, for a recruit or the armory.
#[test]
fun test_requisition_gear() {
    use std::unit_test::assert_eq;

    let mut ts = ts::begin(@0);
    let (registry, acc, rng) = open_account(&mut ts);

    let rifle = acc.requisition_rifle(2, ts.ctx());
    let armor = acc.requisition_armor(1, ts.ctx());
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

/// Any recruit takes any gear: a Rookie is armed with the Plasma Rifle and fitted
/// with Heavy Armor.
#[test]
fun test_rookie_equips_top_gear() {
    use std::unit_test::assert_eq;

    let mut ts = ts::begin(@0);
    let mut recruit = recruit::new("Test", ts.ctx());
    assert!(recruit.rank().is_rookie());

    let rifle = items::rifle(3, ts.ctx());
    let plasma = object::id(&rifle);
    equip_weapon(&mut recruit, rifle);
    assert_eq!(object::id(recruit.weapon().borrow()), plasma);

    let armor = items::armor(3, ts.ctx());
    let heavy = object::id(&armor);
    equip_armor(&mut recruit, armor);
    assert_eq!(object::id(recruit.armor().borrow()), heavy);
    assert!(recruit.rank().is_rookie());

    let (weapon, armor, utilities) = recruit.dismiss();
    utilities.destroy!(|u| u.destroy());
    weapon.destroy!(|w| w.destroy());
    armor.destroy!(|a| a.destroy());
    ts.end();
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
    let _utility = acc.requisition_utility(3, ts.ctx());
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

// === Rating ===

/// Give the player a `rating`, as if they had won `games` ranked games to get it.
public fun set_record_for_testing(acc: &mut Account, rating: u64, games: u64) {
    acc.rating = glicko::new_for_testing(rating, 350, games, 0);
    acc.score = Score { wins: games, losses: 0, draws: 0 };
}

/// The `Rules` the reset reads its cooldown from, and a clock.
fun reset_setup(ts: &mut ts::Scenario): (Registry, Account, Random, ghosts::rules::Rules, Clock) {
    let (registry, acc, rng) = open_account(ts);
    let (rules, cap) = ghosts::rules::new(vector[], ts.ctx());
    std::unit_test::destroy(cap);
    let clock = sui::clock::create_for_testing(ts.ctx());
    (registry, acc, rng, rules, clock)
}

fun reset_teardown(
    ts: ts::Scenario,
    registry: Registry,
    acc: Account,
    rng: Random,
    rules: ghosts::rules::Rules,
    clock: Clock,
) {
    std::unit_test::destroy(rules);
    clock.destroy_for_testing();
    close_account(ts, registry, acc, rng);
}

/// From above the default, a reset is exactly the default, deviation and all:
/// the score stays, and the count of resets and its time are kept. Another one
/// waits for the cooldown, to the millisecond.
#[test]
fun test_reset_rating() {
    use std::unit_test::assert_eq;

    let mut ts = ts::begin(@0);
    let (registry, mut acc, rng, rules, mut clock) = reset_setup(&mut ts);
    acc.set_record_for_testing(1720, 9);

    clock.set_for_testing(1_000);
    acc.reset_rating(&rules, &clock, ts.ctx());
    assert_eq!(acc.rating(), glicko::default());
    assert_eq!(acc.rating().rating(), 1500);
    assert_eq!(acc.rating().deviation(), 350);
    assert_eq!(acc.resets(), 1);
    assert_eq!(acc.last_reset_ms(), 1_000);
    assert_eq!(acc.games_played(), 9);

    // back up, and down again once the cooldown is over
    acc.set_record_for_testing(1600, 12);
    clock.set_for_testing(1_000 + rules.reset_cooldown_ms());
    acc.reset_rating(&rules, &clock, ts.ctx());
    assert_eq!(acc.rating(), glicko::default());
    assert_eq!(acc.resets(), 2);
    assert_eq!(acc.last_reset_ms(), 1_000 + rules.reset_cooldown_ms());

    reset_teardown(ts, registry, acc, rng, rules, clock);
}

/// Never a way up: not from the default...
#[test, expected_failure(abort_code = ENotAboveDefault)]
fun test_reset_at_default_fail() {
    let mut ts = ts::begin(@0);
    let (_registry, mut acc, _rng, rules, clock) = reset_setup(&mut ts);
    acc.reset_rating(&rules, &clock, ts.ctx());
    abort
}

/// ...nor from below it.
#[test, expected_failure(abort_code = ENotAboveDefault)]
fun test_reset_below_default_fail() {
    let mut ts = ts::begin(@0);
    let (_registry, mut acc, _rng, rules, clock) = reset_setup(&mut ts);
    acc.set_record_for_testing(1340, 3);
    acc.reset_rating(&rules, &clock, ts.ctx());
    abort
}

#[test, expected_failure(abort_code = ENotIdle)]
fun test_reset_while_searching_fail() {
    let mut ts = ts::begin(@0);
    let (_registry, mut acc, _rng, rules, clock) = reset_setup(&mut ts);
    acc.set_record_for_testing(1720, 9);
    acc.start_search(@1.to_id(), 0, @2.to_id(), option::none());
    acc.reset_rating(&rules, &clock, ts.ctx());
    abort
}

#[test, expected_failure(abort_code = ENotIdle)]
fun test_reset_while_playing_fail() {
    let mut ts = ts::begin(@0);
    let (_registry, mut acc, _rng, rules, clock) = reset_setup(&mut ts);
    acc.set_record_for_testing(1720, 9);
    acc.set_playing(@1.to_id());
    acc.reset_rating(&rules, &clock, ts.ctx());
    abort
}

/// A millisecond short of the cooldown.
#[test, expected_failure(abort_code = EResetCooldown)]
fun test_reset_within_cooldown_fail() {
    let mut ts = ts::begin(@0);
    let (_registry, mut acc, _rng, rules, mut clock) = reset_setup(&mut ts);
    acc.set_record_for_testing(1720, 9);
    acc.reset_rating(&rules, &clock, ts.ctx());
    acc.set_record_for_testing(1720, 10);
    clock.set_for_testing(rules.reset_cooldown_ms() - 1);
    acc.reset_rating(&rules, &clock, ts.ctx());
    abort
}

#[test, expected_failure(abort_code = ENotOwner)]
fun test_reset_foreign_account_fail() {
    let mut ts = ts::begin(@0);
    let (_registry, mut acc, _rng, rules, clock) = reset_setup(&mut ts);
    acc.set_record_for_testing(1720, 9);
    ts.next_tx(@2);
    acc.reset_rating(&rules, &clock, ts.ctx());
    abort
}

/// A suspension is a field of its own: playing, searching and going idle again
/// leave it as it is.
#[test]
fun test_suspension_outlives_the_state() {
    use std::unit_test::assert_eq;

    let mut ts = ts::begin(@0);
    let (registry, mut acc, rng) = open_account(&mut ts);
    acc.suspend(60_000);
    acc.start_search(@1.to_id(), 0, @2.to_id(), option::none());
    acc.set_playing(@3.to_id());
    acc.clear_search();
    assert!(acc.is_idle());
    assert_eq!(acc.suspended_until(), 60_000);
    close_account(ts, registry, acc, rng);
}

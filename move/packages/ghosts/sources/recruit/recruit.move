// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/// Defines the Recruit - an ownable unit in the game. Recruit contains all the
/// information about the unit, its rank, modifications, gear, stats and more.
///
/// Traits:
/// - default
module ghosts::recruit;

use ghosts::{
    armor::Armor,
    rank::{Self, Rank},
    stats::{Self, Stats},
    visuals::{Self, Visuals},
    weapon::Weapon
};
use std::string::String;

/// Attempt to equip a `Weapon` while a Recruit already it.
const EAlreadyHasWeapon: u64 = 1;
/// Trying to remove a `Weapon` that does not exist.
const ENoWeapon: u64 = 2;
/// Attempt to equip an `Armor` while a Recruit already has one.
const EAlreadyHasArmor: u64 = 3;
/// Trying to remove an `Armor` that does not exist.
const ENoArmor: u64 = 4;

/// What a promotion adds to the `aim` stat.
const PROMOTION_AIM: u8 = 2;
/// What every second promotion adds to the `health` stat.
const PROMOTION_HEALTH: u8 = 1;

// Convenience alias which allows simpler conversion from Recruit to Unit.
public use fun ghosts::unit::from_recruit as Recruit.to_unit;

/// Recruit metadata, contains information about the Recruit that is not
/// directly related to the game mechanics.
public struct Metadata has drop, store {
    name: String,
    /// Visual properties of the Recruit, packed by area.
    visuals: Visuals,
    /// Voice configuration: index of one of the available voice sets.
    voice: u8,
}

/// Defines the Recruit - a unit in the game which users hire, train and send on
/// missions. As the Recruit gains experience, they can be promoted to higher
/// ranks and get access to better equipment and abilities.
public struct Recruit has key, store {
    id: UID,
    /// `Metadata` of the Recruit.
    metadata: Metadata,
    /// `Rank` of the Unit.
    rank: Rank,
    /// Experience so far; enough of it is a promotion, see `add_xp`.
    xp: u16,
    /// `Stats` of the Unit.
    stats: Stats,
    /// Weapon of the Unit. When not set, the Recruit uses the default weapon.
    weapon: Option<Weapon>,
    /// Armor of the Unit. When not set, the Recruit uses the default armor.
    armor: Option<Armor>,
    /// The address that hired the Recruit.
    leader: address,
}

/// DogTag is the only thing left after a Recruit dies in battle.
/// It contains the name and rank of the fallen soldier.
public struct DogTag has key, store {
    id: UID,
    /// The rank of the fallen soldier.
    rank: Rank,
    /// Metadata (name and looks) of the fallen recruit.
    metadata: Metadata,
}

/// Add an armor to the Recruit.
public fun add_armor(r: &mut Recruit, armor: Armor) {
    assert!(r.armor.is_none(), EAlreadyHasArmor);
    r.armor.fill(armor);
}

/// Remove the armor from the Recruit.
public fun remove_armor(r: &mut Recruit): Armor {
    assert!(r.armor.is_some(), ENoArmor);
    r.armor.extract()
}

/// Add a weapon to the Recruit.
/// Aborts if the Recruit already has a weapon.
public fun add_weapon(r: &mut Recruit, weapon: Weapon) {
    assert!(r.weapon.is_none(), EAlreadyHasWeapon);
    r.weapon.fill(weapon);
}

/// Remove the weapon from the Recruit.
/// Aborts if the Recruit does not have a weapon.
public fun remove_weapon(r: &mut Recruit): Weapon {
    assert!(r.weapon.is_some(), ENoWeapon);
    r.weapon.extract()
}

/// Get the armor of the Recruit.
public fun armor(r: &Recruit): &Option<Armor> { &r.armor }

/// Get the weapon of the Recruit.
public fun weapon(r: &Recruit): &Option<Weapon> { &r.weapon }

/// Get the stats of the Recruit.
public fun stats(r: &Recruit): &Stats { &r.stats }

/// Get the rank of the Recruit.
public fun rank(r: &Recruit): &Rank { &r.rank }

/// Get the address of the Recruit's leader.
public fun leader(r: &Recruit): address { r.leader }

/// Set the leader of the Recruit. Package-only: the frontend makes the
/// `Account` the leader of its stored recruits, so dog tags and other
/// spoils know where to go.
public(package) fun set_leader(r: &mut Recruit, leader: address) {
    r.leader = leader;
}

/// Set the `Visuals` of the Recruit. Package-only: exposed through the
/// recruit editor in the frontend. The name, once received, stays.
public(package) fun set_visuals(r: &mut Recruit, visuals: Visuals) {
    r.metadata.visuals = visuals;
}

/// Set the voice configuration of the Recruit. Package-only.
public(package) fun set_voice(r: &mut Recruit, voice: u8) {
    r.metadata.voice = voice;
}

/// Get the metadata of the Recruit.
public fun metadata(r: &Recruit): &Metadata { &r.metadata }

/// Promotes the rank of the Recruit.
public(package) fun rank_up(recruit: &mut Recruit) { recruit.rank.rank_up() }

/// Experience earned so far.
public fun xp(r: &Recruit): u16 { r.xp }

/// Add experience, promoting the recruit as far as it takes them. Every promotion
/// sharpens their aim, and every second one toughens them too.
public(package) fun add_xp(recruit: &mut Recruit, xp: u16) {
    recruit.xp = recruit.xp + xp;
    loop {
        let next = recruit.rank.next_rank_xp();
        if (next.is_none() || recruit.xp < next.destroy_some()) break;

        recruit.rank.rank_up();
        let health = if (recruit.rank.ordinal() % 2 == 0) PROMOTION_HEALTH else 0;
        let bonus = stats::new(0, PROMOTION_AIM, health, 0, 0);
        recruit.stats = recruit.stats.add(&bonus);
    }
}

/// Create a new `Recruit` with default values.
public(package) fun default(ctx: &mut TxContext): Recruit {
    Recruit {
        id: object::new(ctx),
        metadata: Metadata { name: "John Doe", visuals: visuals::default(), voice: 0 },
        rank: rank::default(),
        xp: 0,
        stats: stats::default(),
        weapon: option::none(),
        armor: option::none(),
        leader: ctx.sender(),
    }
}

/// Create an unequipped rookie with the given name, default stats, and the
/// transaction sender as leader.
public(package) fun new(name: String, ctx: &mut TxContext): Recruit {
    Recruit {
        id: object::new(ctx),
        metadata: Metadata { name, visuals: visuals::default(), voice: 0 },
        rank: rank::rookie(),
        xp: 0,
        stats: stats::default(),
        weapon: option::none(),
        armor: option::none(),
        leader: ctx.sender(),
    }
}

/// Dismiss the Recruit, remove them forever from the game.
public fun dismiss(recruit: Recruit): (Option<Weapon>, Option<Armor>) {
    let Recruit { id, weapon, armor, .. } = recruit;
    id.delete();
    (weapon, armor)
}

/// Throw away the DogTag, destroy it and bury the memory.
public fun throw_away(dog_tag: DogTag) {
    let DogTag { id, .. } = dog_tag;
    id.delete();
}

/// Kills the Recruit and returns the DogTag, and the weapon they fell with. Armor
/// goes down with them.
public(package) fun kill(recruit: Recruit, ctx: &mut TxContext): (DogTag, Option<Weapon>) {
    let Recruit { id, rank, weapon, metadata, armor, .. } = recruit;
    id.delete();
    armor.destroy!(|a| a.destroy());

    (DogTag { id: object::new(ctx), rank, metadata }, weapon)
}

/// Issue a `Permit` for the `Recruit` type. Package-only: used to create
/// `Display<Recruit>` in the `display` module.
public(package) fun permit(): internal::Permit<Recruit> { internal::permit() }

/// Issue a `Permit` for the `DogTag` type. Package-only: used to create
/// `Display<DogTag>` in the `display` module.
public(package) fun dog_tag_permit(): internal::Permit<DogTag> { internal::permit() }

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

    let (dog_tag, weapon) = recruit.kill(ctx);
    weapon.destroy!(|w| w.destroy());

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

    let (tag, weapon) = recruit.kill(ctx);
    assert!(weapon.is_none());
    weapon.destroy_none();
    tag.throw_away();
}

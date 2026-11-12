// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/// Defines the Recruit - an ownable unit in the game. Recruit contains all the
/// information about the unit, its rank, modifications, gear, stats and more.
///
/// Everything that changes a Recruit is package-only: a player gets to one only
/// through `ghosts::account`, which hands it out under a `Borrow` that settles by
/// sending it back to its leader, and the game, which lets go of it by its death.
///
/// Traits:
/// - default
module ghosts::recruit;

use ghosts::{
    armor::Armor,
    rank::{Self, Rank},
    stats::{Self, Stats},
    utility::Utility,
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
/// Attempt to equip a `Utility` while all the slots of a Recruit are taken.
const EUtilitiesFull: u64 = 5;
/// Trying to remove a `Utility` the Recruit does not carry.
const ENoUtility: u64 = 6;

/// How many `Utility` items a Recruit carries: the number of utility slots.
const MAX_UTILITIES: u64 = 1;

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
    /// Utilities of the Unit, in slot order, at most `MAX_UTILITIES`. They give it
    /// its grenade and the like; none by default.
    utilities: vector<Utility>,
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
public(package) fun add_armor(r: &mut Recruit, armor: Armor) {
    assert!(r.armor.is_none(), EAlreadyHasArmor);
    r.armor.fill(armor);
}

/// Remove the armor from the Recruit.
public(package) fun remove_armor(r: &mut Recruit): Armor {
    assert!(r.armor.is_some(), ENoArmor);
    r.armor.extract()
}

/// Add a weapon to the Recruit.
/// Aborts if the Recruit already has a weapon.
public(package) fun add_weapon(r: &mut Recruit, weapon: Weapon) {
    assert!(r.weapon.is_none(), EAlreadyHasWeapon);
    r.weapon.fill(weapon);
}

/// Remove the weapon from the Recruit.
/// Aborts if the Recruit does not have a weapon.
public(package) fun remove_weapon(r: &mut Recruit): Weapon {
    assert!(r.weapon.is_some(), ENoWeapon);
    r.weapon.extract()
}

/// Add a utility to the Recruit.
/// Aborts if all the utility slots are taken.
public(package) fun add_utility(r: &mut Recruit, utility: Utility) {
    assert!(r.utilities.length() < MAX_UTILITIES, EUtilitiesFull);
    r.utilities.push_back(utility);
}

/// Remove the utility with the given ID from the Recruit. By ID, not by slot:
/// the slots shift as items leave, and an ID stays right within a single PTB.
/// Aborts if the Recruit does not carry it.
public(package) fun remove_utility(r: &mut Recruit, id: ID): Utility {
    let idx = r.utilities.find_index!(|u| object::id(u) == id);
    assert!(idx.is_some(), ENoUtility);
    r.utilities.remove(idx.destroy_some())
}

/// Get the armor of the Recruit.
public fun armor(r: &Recruit): &Option<Armor> { &r.armor }

/// Get the weapon of the Recruit.
public fun weapon(r: &Recruit): &Option<Weapon> { &r.weapon }

/// Get the utilities of the Recruit, in slot order.
public fun utilities(r: &Recruit): &vector<Utility> { &r.utilities }

/// How many utilities a Recruit can carry.
public fun max_utilities(): u64 { MAX_UTILITIES }

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
        utilities: vector[],
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
        utilities: vector[],
        leader: ctx.sender(),
    }
}

/// Dismiss the Recruit, remove them forever from the game.
public(package) fun dismiss(recruit: Recruit): (Option<Weapon>, Option<Armor>, vector<Utility>) {
    let Recruit { id, weapon, armor, utilities, .. } = recruit;
    id.delete();
    (weapon, armor, utilities)
}

/// Throw away the DogTag, destroy it and bury the memory.
public fun throw_away(dog_tag: DogTag) {
    let DogTag { id, .. } = dog_tag;
    id.delete();
}

/// Kills the Recruit and returns the DogTag. Their gear goes down with them.
public(package) fun kill(recruit: Recruit, ctx: &mut TxContext): DogTag {
    let Recruit { id, rank, weapon, metadata, armor, utilities, .. } = recruit;
    id.delete();
    weapon.destroy!(|w| w.destroy());
    armor.destroy!(|a| a.destroy());
    utilities.destroy!(|u| u.destroy());

    DogTag { id: object::new(ctx), rank, metadata }
}

/// Issue a `Permit` for the `Recruit` type. Package-only: used to create
/// `Display<Recruit>` in the `display` module.
public(package) fun permit(): internal::Permit<Recruit> { internal::permit() }

/// Issue a `Permit` for the `DogTag` type. Package-only: used to create
/// `Display<DogTag>` in the `display` module.
public(package) fun dog_tag_permit(): internal::Permit<DogTag> { internal::permit() }

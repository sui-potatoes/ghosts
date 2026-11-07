// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/// Defines the Weapon - a piece of equipment that Recruits can use in battle.
/// Weapons have different stats and can be upgraded with additional modules.
module ghosts::weapon;

use ghosts::{rank::{Self, Rank}, stats::{Self, Stats}, weapon_upgrade::WeaponUpgrade};
use std::string::String;

/// Attempt to attach too many upgrades to a weapon.
const ETooManyUpgrades: u64 = 1;
/// Attempt to remove an upgrade that does not exist.
const ENoUpgrade: u64 = 2;
/// Attempt to attach an upgrade of a kind the weapon already has.
const EUpgradeKindTaken: u64 = 3;

/// Weapon is an equipment that Recruits can use in battle. Each weapon has its
/// own stats with a potential to be upgraded with additional modules.
///
/// Some weapons might be unique and have special abilities.
public struct Weapon has key, store {
    id: UID,
    /// The name of the weapon. "Plasma Rifle", "Sniper Rifle", etc.
    name: String,
    /// The `Stats` of the weapon.
    stats: Stats,
    /// The list of upgrades that the weapon has.
    upgrades: vector<WeaponUpgrade>,
    /// The rank a recruit needs to be issued this weapon at headquarters.
    required_rank: Rank,
}

/// Create a new `Weapon` with the provided parameters.
public(package) fun new(name: String, stats: Stats, ctx: &mut TxContext): Weapon {
    Weapon { id: object::new(ctx), name, stats, upgrades: vector[], required_rank: rank::default() }
}

/// The same weapon, for recruits of at least this rank.
public(package) fun for_rank(mut w: Weapon, rank: Rank): Weapon {
    w.required_rank = rank;
    w
}

/// The rank a recruit needs to be issued this weapon.
public fun required_rank(w: &Weapon): &Rank { &w.required_rank }

/// Create a new default `Weapon`.
public(package) fun default(ctx: &mut TxContext): Weapon {
    new("Standard Issue Rifle", stats::default_weapon(), ctx)
}

/// Destroy the `Weapon`.
public fun destroy(weapon: Weapon) {
    let Weapon { id, .. } = weapon;
    id.delete();
}

/// Issue a `Permit` for the `Weapon` type. Package-only: used to create
/// `Display<Weapon>` in the `display` module.
public(package) fun permit(): internal::Permit<Weapon> { internal::permit() }

/// Get the name of the `Weapon`.
public fun name(w: &Weapon): String { w.name }

/// Get the stats of the `Weapon`.
public fun stats(w: &Weapon): &Stats { &w.stats }

/// Get the upgrades of the `Weapon`.
public fun upgrades(w: &Weapon): &vector<WeaponUpgrade> { &w.upgrades }

/// Add an upgrade to the `Weapon`: at most three, one of each kind.
public fun add_upgrade(w: &mut Weapon, upgrade: WeaponUpgrade) {
    assert!(w.upgrades.length() < 3, ETooManyUpgrades);
    assert!(!w.upgrades.any!(|u| u.kind() == upgrade.kind()), EUpgradeKindTaken);
    w.stats = w.stats.add(upgrade.modifier());
    w.upgrades.push_back(upgrade);
}

/// Remove an upgrade from the `Weapon`.
public fun remove_upgrade(w: &mut Weapon, upgrade_idx: u8): WeaponUpgrade {
    assert!(w.upgrades.length() > upgrade_idx as u64, ENoUpgrade);
    let upgrade = w.upgrades.remove(upgrade_idx as u64);
    w.stats = w.stats.add(&upgrade.modifier().negate());
    upgrade
}

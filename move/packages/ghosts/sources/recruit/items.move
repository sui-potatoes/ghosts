// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/// Contains all definitions for items that can be used by `Recruits`.
module ghosts::items;

use bit_field::bit_field as bf;
use ghosts::{
    action::{Self, Action},
    armor::{Self, Armor},
    stats::{Self, Stats},
    utility::{Self, Utility},
    weapon::{Self, Weapon},
    weapon_upgrade::{Self as upgrade, WeaponUpgrade}
};
use std::string::String;

/// `WeaponUpgrade` kinds: a `Weapon` takes one of each.
const SCOPE: u8 = 0;
const LASER_SIGHT: u8 = 1;
const STOCK: u8 = 2;
const EXPANDED_CLIP: u8 = 3;

// === Armor ===

/// Creates a new `Armor` with the given tier.
public(package) fun armor(tier: u8, ctx: &mut TxContext): Armor {
    let name = match (tier) {
        1 => "Light Armor",
        2 => "Medium Armor",
        3 => "Heavy Armor",
        _ => abort,
    };
    armor::new(name, armor_stats(tier), ctx)
}

/// The stats of the `Armor` of the given tier: the modifier it adds to its
/// wearer. A unit built without the object, see `unit::from_loadout`, adds the
/// same.
public(package) fun armor_stats(tier: u8): Stats {
    let stats = match (tier) {
        // +1 ARM, +10% DODGE
        1 => vector[0, 0, 0, 1, 10],
        // +2 ARM
        2 => vector[0, 0, 0, 2, 0],
        // -1 MOB, +1 HP, +3 ARM, -10% DODGE
        3 => vector[128 + 1, 0, 1, 3, 128 + 10],
        _ => abort,
    };
    stats::new_unchecked(bf::pack_u8!(stats))
}

// === Utilities ===

/// `Utility` kinds, as requisitioned. Only appended.
const FRAG_GRENADE: u8 = 0;
const FLASHBANG: u8 = 1;
const SMOKE_GRENADE: u8 = 2;

/// Whether there is a utility of the given kind.
public(package) fun is_utility(kind: u8): bool { kind <= SMOKE_GRENADE }

/// Creates a utility of the given kind. Aborts on an unknown kind.
public(package) fun utility(kind: u8, ctx: &mut TxContext): Utility {
    let name = match (kind) {
        FRAG_GRENADE => "Frag Grenade",
        FLASHBANG => "Flashbang",
        SMOKE_GRENADE => "Smoke Grenade",
        _ => abort,
    };
    let (stats, actions) = utility_parts(kind);
    utility::new(name, stats, actions, ctx)
}

/// What a utility of the given kind adds to its carrier: its stats and its
/// actions. Every grenade is an action usable once per match, the `uses` of the
/// action being the only budget there is, and adds nothing else, so its stats
/// are the zero modifier. Their numbers are in `map::perform_grenade`,
/// `map::perform_flashbang` and `map::perform_smoke_grenade`. Aborts on an
/// unknown kind.
public(package) fun utility_parts(kind: u8): (Stats, vector<Action>) {
    let kind = match (kind) {
        FRAG_GRENADE => action::new_grenade(),
        FLASHBANG => action::new_flashbang(),
        SMOKE_GRENADE => action::new_smoke_grenade(),
        _ => abort,
    };
    (stats::new(0, 0, 0, 0, 0), vector[action::limited(kind, 1)])
}

/// A frag grenade: a `Grenade` action, see `utility_parts`.
public(package) fun frag_grenade(ctx: &mut TxContext): Utility { utility(FRAG_GRENADE, ctx) }

/// A flashbang: a `Flashbang` action, see `utility_parts`.
public(package) fun flashbang(ctx: &mut TxContext): Utility { utility(FLASHBANG, ctx) }

/// A smoke grenade: a `SmokeGrenade` action, see `utility_parts`.
public(package) fun smoke_grenade(ctx: &mut TxContext): Utility { utility(SMOKE_GRENADE, ctx) }

// === Weapons ===

/// Creates a new rifle with the given tier.
public(package) fun rifle(tier: u8, ctx: &mut TxContext): Weapon {
    let name = match (tier) {
        1 => "Standard Rifle",
        2 => "Sharpshooter Rifle",
        3 => "Plasma Rifle",
        _ => abort,
    };
    weapon::new(name, rifle_stats(tier), ctx)
}

/// The stats of the rifle of the given tier. A unit built without the object,
/// see `unit::from_loadout`, fights with the same.
public(package) fun rifle_stats(tier: u8): Stats {
    let stats: u128 = match (tier) {
        // 4 DMG, 2 SPREAD, +10% CRIT, 0 AREA, 4 RANGE, 3 AMMO
        1 => 0x03_04_00_00_01_0A_0A_02_04,
        // 5 DMG, 1 SPREAD, +20% CRIT, 0 AREA, 5 RANGE, 3 AMMO
        2 => 0x03_05_00_00_01_14_14_01_05,
        // 6 DMG, 1 SPREAD, +30% CRIT, 0 AREA, 5 RANGE, 3 AMMO
        3 => 0x03_05_00_00_01_1E_1E_01_06,
        _ => abort,
    };
    stats::new_unchecked(stats << (6 * 8))
}

// === Weapon Upgrades ===

/// Adds `5-15%` to the `aim` stat of the `Weapon` depending on the tier.
public(package) fun scope(tier: u8, ctx: &mut TxContext): WeaponUpgrade {
    let (name, stats): (String, u128) = match (tier) {
        // +5 AIM
        1 => ("Basic Scope", 0x05 << (1 * 8)),
        // +10 AIM
        2 => ("Advanced Scope", 0x0A << (1 * 8)),
        // +15 AIM
        3 => ("Superior Scope", 0x0F << (1 * 8)),
        _ => abort,
    };

    upgrade::new(name, SCOPE, tier, stats::new_unchecked(stats), ctx)
}

/// Adds `5-15%` to the `crit_chance` stat of the `Weapon` depending on the tier.
public(package) fun laser_sight(tier: u8, ctx: &mut TxContext): WeaponUpgrade {
    let (name, stats): (String, u128) = match (tier) {
        // +5 CRIT
        1 => ("Basic Laser Sight", 0x05 << (9 * 8)),
        // +10 CRIT
        2 => ("Advanced Laser Sight", 0x0A << (9 * 8)),
        // +15 CRIT
        3 => ("Sniper Laser Sight", 0x0F << (9 * 8)),
        _ => abort,
    };

    upgrade::new(name, LASER_SIGHT, tier, stats::new_unchecked(stats), ctx)
}

/// Adds 1-3 to `range` stat of the `Weapon` depending on the tier.
public(package) fun stock(tier: u8, ctx: &mut TxContext): WeaponUpgrade {
    let (name, stats): (String, u128) = match (tier) {
        // +1 RANGE
        1 => ("Basic Stock", 0x01 << (13 * 8)),
        // +2 RANGE
        2 => ("Advanced Stock", 0x02 << (13 * 8)),
        // +3 RANGE
        3 => ("Sniper Stock", 0x03 << (13 * 8)),
        _ => abort,
    };

    upgrade::new(name, STOCK, tier, stats::new_unchecked(stats), ctx)
}

/// Expanded clip increases the `ammo` stat by 1-3 depending on the tier.
public(package) fun expanded_clip(tier: u8, ctx: &mut TxContext): WeaponUpgrade {
    let (name, stats): (String, u128) = match (tier) {
        // +1 AMMO
        1 => ("Basic Expanded Clip", 0x01 << (14 * 8)),
        // +2 AMMO
        2 => ("Advanced Expanded Clip", 0x02 << (14 * 8)),
        // +3 AMMO
        3 => ("Superior Expanded Clip", 0x03 << (14 * 8)),
        _ => abort,
    };

    upgrade::new(name, EXPANDED_CLIP, tier, stats::new_unchecked(stats), ctx)
}

/// A weapon upgrade of the given kind and tier.
public(package) fun upgrade(kind: u8, tier: u8, ctx: &mut TxContext): WeaponUpgrade {
    match (kind) {
        SCOPE => scope(tier, ctx),
        LASER_SIGHT => laser_sight(tier, ctx),
        STOCK => stock(tier, ctx),
        EXPANDED_CLIP => expanded_clip(tier, ctx),
        _ => abort,
    }
}

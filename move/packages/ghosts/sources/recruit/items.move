// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/// Contains all definitions for items that can be used by `Recruits`.
module ghosts::items;

use bit_field::bit_field as bf;
use ghosts::{
    armor::{Self, Armor},
    rank,
    stats,
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
    let (name, stats): (String, _) = match (tier) {
        // +1 ARM, +10% DODGE
        1 => ("Light Armor", vector[0, 0, 0, 1, 10]),
        // +2 ARM
        2 => ("Medium Armor", vector[0, 0, 0, 2, 0]),
        // -1 MOB, +1 HP, +3 ARM, -10% DODGE
        3 => ("Heavy Armor", vector[128 + 1, 0, 1, 3, 128 + 10]),
        _ => abort,
    };

    let armor = armor::new(name, stats::new_unchecked(bf::pack_u8!(stats)), ctx);
    match (tier) {
        2 => armor.for_rank(rank::squaddie()),
        3 => armor.for_rank(rank::sergeant()),
        _ => armor,
    }
}

// === Weapons ===

/// Creates a new rifle with the given tier.
public(package) fun rifle(tier: u8, ctx: &mut TxContext): Weapon {
    let (name, stats): (String, u128) = match (tier) {
        // 4 DMG, 2 SPREAD, +10% CRIT, 0 AREA, 4 RANGE, 3 AMMO
        1 => ("Standard Rifle", 0x03_04_00_00_01_0A_0A_02_04 << (6 * 8)),
        // 5 DMG, 1 SPREAD, +20% CRIT, 0 AREA, 5 RANGE, 3 AMMO
        2 => ("Sharpshooter Rifle", 0x03_05_00_00_01_14_14_01_05 << (6 * 8)),
        // 6 DMG, 1 SPREAD, +30% CRIT, 0 AREA, 5 RANGE, 3 AMMO
        3 => ("Plasma Rifle", 0x03_05_00_00_01_1E_1E_01_06 << (6 * 8)),
        _ => abort,
    };
    let rifle = weapon::new(name, stats::new_unchecked(stats), ctx);
    match (tier) {
        2 => rifle.for_rank(rank::corporal()),
        3 => rifle.for_rank(rank::lieutenant()),
        _ => rifle,
    }
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

// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * BCS schemas mirroring the on-chain types of the ghosts Move package
 * (`move/packages/ghosts`), with fields in Move struct order;
 * the names here are local to the app.
 */

import { bcs } from "@mysten/sui/bcs";

/** `sui::table::Table` / `sui::object_table::ObjectTable`: its id and size. */
export const Table = bcs.struct("Table", {
    id: bcs.Address,
    size: bcs.u64(),
});

/** `sui::table_vec::TableVec`. */
export const TableVec = bcs.struct("TableVec", { contents: Table });

/** `ghosts::stats::Stats`: 15 `u8` parameters packed into one `u128`. */
export const Stats = bcs.struct("Stats", { value: bcs.u128() });

/**
 * `ghosts::visuals::Visuals`: five areas of 32 packed `u8` slots, laid out by
 * the appearance codec (`@ghosts/squad/appearance/codec`).
 */
export const Visuals = bcs.struct("Visuals", {
    head: bcs.u256(),
    face: bcs.u256(),
    eyes: bcs.u256(),
    body: bcs.u256(),
    outfit: bcs.u256(),
});

/** `ghosts::recruit::Metadata`. */
export const Metadata = bcs.struct("Metadata", {
    name: bcs.string(),
    visuals: Visuals,
    voice: bcs.u8(),
});

/** `ghosts::rank::Rank`; the decoded `$kind` is the rank's name. */
export const Rank = bcs.enum("Rank", {
    Rookie: null,
    Squaddie: null,
    Corporal: null,
    Sergeant: null,
    Lieutenant: null,
    Captain: null,
    Major: null,
    Colonel: null,
});

/** `ghosts::weapon_upgrade::WeaponUpgrade`. */
export const WeaponUpgrade = bcs.struct("WeaponUpgrade", {
    name: bcs.string(),
    kind: bcs.u8(),
    tier: bcs.u8(),
    modifier: Stats,
});

/** `ghosts::weapon::Weapon`. */
export const Weapon = bcs.struct("Weapon", {
    id: bcs.Address,
    name: bcs.string(),
    stats: Stats,
    upgrades: bcs.vector(WeaponUpgrade),
});

/** `ghosts::armor::Armor`. */
export const Armor = bcs.struct("Armor", {
    id: bcs.Address,
    name: bcs.string(),
    stats: Stats,
});

/** `ghosts::recruit::Recruit`. */
export const Recruit = bcs.struct("Recruit", {
    id: bcs.Address,
    metadata: Metadata,
    rank: Rank,
    stats: Stats,
    weapon: bcs.option(Weapon),
    armor: bcs.option(Armor),
    leader: bcs.Address,
});

/** `ghosts::ghosts::Registry`. */
export const Registry = bcs.struct("Registry", {
    id: bcs.Address,
    accounts: Table,
    visualPresets: bcs.vector(bcs.vector(bcs.u256())),
});

/** `ghosts::ghosts::Account`. */
export const Account = bcs.struct("Account", {
    id: bcs.Address,
    owner: bcs.Address,
    recruits: Table,
    weapons: Table,
    armors: Table,
    upgrades: bcs.vector(WeaponUpgrade),
    dogTags: TableVec,
    replays: TableVec,
});

/** `sui::dynamic_field::Field<address, ID>` — one `Registry.accounts` record. */
export const AccountRecord = bcs.struct("Field", {
    id: bcs.Address,
    name: bcs.Address,
    value: bcs.Address,
});

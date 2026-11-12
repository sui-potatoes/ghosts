// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/// Unit is a representation of the `Recruit` in the game. It copies most of the
/// fields of the `Recruit` into a "digestible" form for the `Map`. Units are
/// placed on the `Map` directly and linked to their corresponding `Recruit`s
/// via the `address` -> `UID`.
///
/// Traits:
/// - from_bcs
/// - to_string
module ghosts::unit;

use ghosts::{
    action::{Self, Action, ActionKind},
    param::{Self, Param},
    recruit::Recruit,
    stats::{Self, Stats},
    utility::Utility
};
use std::string::String;
use sui::{bcs::{Self, BCS}, random::RandomGenerator};

/// Trying to attack a target that is out of range.
const ERangeExceeded: u64 = 1;
/// Trying to attack with no ammo.
const EOutOfAmmo: u64 = 2;
/// No AP left to perform an action.
const ENoAP: u64 = 3;
/// Trying to reload at full clip capacity.
const EFullAmmo: u64 = 4;
/// The `Unit` does not have the `Action` it is ordered to perform.
const EActionNotAllowed: u64 = 5;
/// Every `Action` of that kind has its uses spent.
const ENoUsesLeft: u64 = 6;

/// Weapon range can be exceeded by this value with aim penalty.
const MAX_RANGE_OFFSET: u8 = 3;
/// If distance is less than range, the aim bonus is applied for each tile.
const DISTANCE_BONUS: u8 = 5;
/// If distance is greater than range, the aim penalty is applied for each tile.
const DISTANCE_PENALTY: u8 = 10;

/// A single `Unit` on the `Map`.
public struct Unit has copy, store {
    /// The `ID` of the `Recruit`.
    recruit: ID,
    /// The `Account` the `Recruit` belongs to, its leader: whose unit it is.
    owner: ID,
    /// Number of actions the `Unit` can perform in a single turn. Resets at the
    /// beginning of each turn. A single action takes 1 point, options vary from
    /// moving, attacking, using abilities, etc.
    ap: Param,
    /// The HP of the `Unit`.
    hp: Param,
    /// The ammo of the `Unit`.
    ammo: Param,
    /// Stats of the `Recruit`.
    stats: Stats,
    /// What the `Unit` can be ordered to do, in order: the base actions, the weapon's
    /// (both unlimited), then those of each `Utility` in slot order, as they are
    /// there with their `uses`. Two actions of a kind are two entries, each with
    /// its own count. Checked before anything else.
    actions: vector<Action>,
}

/// Give the `Unit` its action points back, as its side's turn begins.
public fun reset_ap(unit: &mut Unit) { unit.ap.reset() }

/// Spend 1 AP on movement; abort if distance exceeds mobility or AP is zero.
public fun perform_move(unit: &mut Unit, distance: u8) {
    assert!(unit.has_action(action::new_move()), EActionNotAllowed);
    assert!(unit.stats.mobility() >= distance, ERangeExceeded);
    assert!(unit.ap.value() > 0, ENoAP);

    unit.spend_use(action::new_move());
    unit.ap.decrease(1);
}

/// Reload `Unit`'s weapon. It costs 1 AP.
public fun perform_reload(unit: &mut Unit) {
    assert!(unit.has_action(action::new_reload()), EActionNotAllowed);
    assert!(unit.ap.value() > 0, ENoAP);
    assert!(!unit.ammo.is_full(), EFullAmmo);
    unit.spend_use(action::new_reload());
    unit.ap.decrease(1);
    unit.ammo.reset();
}

/// Throw a grenade if the unit has one: a `Grenade` action, from a `Utility`. It
/// costs 1 AP and 1 use of the first `Grenade` action that has one left.
public fun perform_grenade(unit: &mut Unit) {
    assert!(unit.has_action(action::new_grenade()), EActionNotAllowed);
    assert!(unit.ap.value() > 0, ENoAP);

    unit.spend_use(action::new_grenade());
    // consumption would go here: a utility spent in a match could be lost with
    // the recruit's gear; consumables need design
    unit.ap.decrease(1);
}

/// Spend one use of the first action of the `kind` that has one left; an unlimited
/// action (`none`) always has, and is not touched. Aborts with `ENoUsesLeft` if
/// every action of that kind is spent. The caller has checked `has_action`.
fun spend_use(unit: &mut Unit, kind: ActionKind) {
    let idx = unit.actions.find_index!(|a| a.kind() == kind && a.has_uses());
    assert!(idx.is_some(), ENoUsesLeft);
    unit.actions[idx.destroy_some()].spend();
}

#[allow(lint(public_random))]
/// Deplete AP, consume one round and roll an attack using the unit's stats.
/// Abort if the unit cannot attack, AP or ammo is zero, or range exceeds weapon range plus
/// `MAX_RANGE_OFFSET`. Hit chance includes range bonuses or penalties and
/// subtracts `target_defense`.
///
/// On a hit, vary base damage by up to the `spread` stat, roll `plus_one`
/// and `crit_chance`, add half the base damage for a critical hit, and cap
/// damage at 255. This function does not apply armor, dodge or HP changes.
///
/// Returns: (is_hit, is_plus_one, is_critical, damage, hit_chance).
public fun perform_attack(
    unit: &mut Unit,
    rng: &mut RandomGenerator,
    range: u8,
    target_defense: u8,
): (bool, bool, bool, u8, u8) {
    assert!(unit.has_action(action::new_attack()), EActionNotAllowed);
    assert!(unit.ap.value() > 0, ENoAP);
    assert!(unit.ammo.value() > 0, EOutOfAmmo);

    unit.spend_use(action::new_attack());
    unit.ap.deplete();
    unit.ammo.decrease(1);

    let crit_chance = unit.stats.crit_chance();
    let dmg_stat = unit.stats.damage();
    let eff_range = unit.stats.range();
    let aim_stat = unit.stats.aim();
    let spread = MAX_RANGE_OFFSET;

    assert!(eff_range + spread >= range, ERangeExceeded);

    // aim stat is affected by the range; intermediate math is done in u16 to
    // avoid overflow on high `aim` / `range` stats
    let hit_chance = if (eff_range == range) {
        aim_stat
    } else if (eff_range > range) {
        ((aim_stat as u16) + (DISTANCE_BONUS as u16) * ((eff_range - range) as u16)).min(100) as u8
    } else {
        aim_stat - (DISTANCE_PENALTY * (range - eff_range)).min(aim_stat)
    };

    // adjust the hit chance by the target's defense, avoid underflow
    let hit_chance = hit_chance - hit_chance.min(target_defense);

    let is_hit = rng.generate_u8_in_range(0, 99) < hit_chance;
    if (!is_hit) return (false, false, false, 0, hit_chance);

    // damage math is done in u16 and capped at u8 max to avoid overflow and
    // underflow on extreme `damage` / `spread` stats
    let spread = unit.stats.spread();
    let is_critical = rng.generate_u8_in_range(0, 99) < crit_chance;
    let damage = match (rng.generate_bool()) {
        true => (dmg_stat as u16) + (rng.generate_u8_in_range(0, spread) as u16),
        false => (dmg_stat - rng.generate_u8_in_range(0, spread.min(dmg_stat))) as u16,
    };

    let is_plus_one = rng.generate_u8_in_range(0, 99) < unit.stats.plus_one();
    let damage = if (is_plus_one) damage + 1 else damage;
    let damage = if (is_critical) damage + (dmg_stat as u16) / 2 else damage;

    (true, is_plus_one, is_critical, damage.min(0xFF) as u8, hit_chance)
}

#[allow(lint(public_random))]
/// Apply damage to unit, can be dodged (shot) or not (explosive).
///
/// Returns: (is_dodged, damage applied, is_kia),
public fun apply_damage(
    unit: &mut Unit,
    rng: &mut RandomGenerator,
    damage: u8,
    can_dodge: bool,
): (bool, u8, bool) {
    let dodge_stat = unit.stats.dodge();
    let armor_stat = unit.stats.armor();
    let damage = if (armor_stat >= damage) 1 else damage - armor_stat;

    // if attack can be dodged, spin the wheel and see if the unit dodges
    let rng = rng.generate_u8_in_range(0, 99);
    if (can_dodge && rng < dodge_stat) {
        return (true, 0, false)
    };

    let hp_left = unit.hp.decrease(damage as u16);
    (false, damage, hp_left == 0)
}

/// Creates a new `Unit` - an in-game representation of a `Recruit`.
///
/// Weapon, armor and utilities are applied to the `Recruit`'s own stats one after
/// the other, in that order. `Stats::add` floors every field at zero against its
/// base, so folding the armor into the weapon first would lose a negative armor
/// modifier (heavy armor's mobility and dodge penalties) against the weapon's
/// zero operative fields; utilities follow the armor for the same reason.
///
/// Actions come in order: `Move`; `Attack` and `Reload` with a weapon; then those
/// of each utility in slot order, as they are on the item. None is merged with
/// another of its kind.
public fun from_recruit(recruit: &Recruit): Unit {
    let mut stats = *recruit.stats();
    let mut armor_stats = stats::default_armor();
    let mut weapon_stats = stats::default_weapon();
    recruit.weapon().do_ref!(|w| weapon_stats = *w.stats());
    recruit.armor().do_ref!(|a| armor_stats = *a.stats());
    stats = stats.add(&weapon_stats).add(&armor_stats);
    recruit.utilities().do_ref!(|u| stats = stats.add(u.stats()));

    // `Move` is the base action; the weapon gives `Attack` and `Reload`, so an
    // unarmed recruit cannot shoot, and a utility gives what it gives.
    let mut actions = vector[action::unlimited(action::new_move())];
    if (recruit.weapon().is_some()) {
        actions.push_back(action::unlimited(action::new_attack()));
        actions.push_back(action::unlimited(action::new_reload()));
    };
    recruit.utilities().do_ref!(|u| actions.append(*u.actions()));

    Unit {
        recruit: object::id(recruit),
        owner: recruit.leader().to_id(),
        ap: param::new(2),
        hp: param::new(stats.health() as u16),
        ammo: param::new(stats.ammo() as u16),
        stats,
        actions,
    }
}

/// Consume the `Unit` and return its recruit ID.
public fun destroy(unit: Unit): ID {
    let Unit { recruit, .. } = unit;
    recruit
}

// === Accessors ===

/// Get the `Recruit`'s ID from the `Unit`.
public fun recruit_id(unit: &Unit): ID { unit.recruit }

/// Get the `Account` the unit's `Recruit` belongs to.
public fun owner(unit: &Unit): ID { unit.owner }

/// Get the `Unit`'s HP.
public fun hp(unit: &Unit): u16 { unit.hp.value() }

/// Get the `Unit`'s AP.
public fun ap(unit: &Unit): u16 { unit.ap.value() }

/// Get the `Unit`'s ammo.
public fun ammo(unit: &Unit): u16 { unit.ammo.value() }

/// Get the `Unit`'s stats.
public fun stats(unit: &Unit): &Stats { &unit.stats }

/// Get the actions the `Unit` can perform, with their uses left: see `Unit.actions`.
public fun actions(unit: &Unit): &vector<Action> { &unit.actions }

/// Get whether the `Unit` has an action of the `kind`, whatever uses are left.
public fun has_action(unit: &Unit, kind: ActionKind): bool {
    unit.actions.any!(|a| a.kind() == kind)
}

// === Convenience and compatibility ===

/// Deserialize bytes into a `Rank`.
public fun from_bytes(bytes: vector<u8>): Unit {
    from_bcs(&mut bcs::new(bytes))
}

/// Helper method to allow nested deserialization of `Unit`.
public(package) fun from_bcs(bcs: &mut BCS): Unit {
    Unit {
        recruit: bcs.peel_address().to_id(),
        owner: bcs.peel_address().to_id(),
        ap: param::from_bcs(bcs),
        hp: param::from_bcs(bcs),
        ammo: param::from_bcs(bcs),
        stats: stats::from_bcs(bcs),
        actions: bcs.peel_vec!(|bcs| action::from_bcs(bcs)),
    }
}

/// Print the `Unit` as a `String`: HP, AP and ammo as `value/max`.
public fun to_string(unit: &Unit): String {
    let mut str = b"HP ".to_string();
    str.append(unit.hp.to_string());
    str.append_utf8(b" AP ");
    str.append(unit.ap.to_string());
    str.append_utf8(b" AMMO ");
    str.append(unit.ammo.to_string());
    str
}

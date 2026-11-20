// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/// The rules of ranked games: what each item costs and from which tier it is
/// unlocked, the tiers a rating falls into and the credits each one gets per
/// size of squad, the queue and the level of each size, and the numbers the
/// ranked flow runs on. One shared `Rules`, created on publish; whoever holds the
/// `RulesCap` retunes it, every write bumping its `version`, so that balance moves
/// without a new package. Readers take `&Rules`.
///
/// A ranked squad is a loadout per unit, three bytes each: the rifle tier, the
/// armor tier and the utility kind, `NO_UTILITY` for none (see `items`). Every
/// unit carries a rifle and an armor. `check_squad` holds it to the tier's budget
/// and unlocks; a squad is built from it by `unit::from_loadout`. The rules can
/// only price what `items` builds: a new item is a new package.
module ghosts::rules;

/// The squad is not three bytes for each unit of its size.
const ESquadSize: u64 = 0;
/// No such item: a rifle or armor tier, or a utility kind, the rules do not have.
const EUnknownItem: u64 = 1;
/// The item is not unlocked at the tier.
const EItemLocked: u64 = 2;
/// The squad costs more than the tier's budget for its size.
const EOverBudget: u64 = 3;
/// The queue is not the ranked queue of any size.
const EWrongQueue: u64 = 4;
/// The size has no level: it cannot be queued for.
const ENoLevel: u64 = 5;
/// A tier out of range, out of order, or without a budget for every size.
const EBadTier: u64 = 6;
/// The rules have no such size.
const ENoSize: u64 = 7;

/// The utility byte of a unit that carries none.
const NO_UTILITY: u8 = 0xFF;
/// The item slots of `set_item`, in the order of a unit's bytes.
const WEAPON: u8 = 0;
const ARMOR: u8 = 1;
const UTILITY: u8 = 2;

/// The rules of ranked games, shared.
public struct Rules has key {
    id: UID,
    /// Bumped by every write of the `RulesCap`.
    version: u32,
    /// The rifles: index `i` is the rifle of tier `i + 1`.
    weapons: vector<Item>,
    /// The armors: index `i` is the armor of tier `i + 1`.
    armor: vector<Item>,
    /// The utilities: index `i` is the utility of kind `i`.
    utilities: vector<Item>,
    /// The tiers, by ascending `min_rating`: a tier is its index.
    tiers: vector<Tier>,
    /// The sizes of ranked squads, each with its queue and level.
    sizes: vector<Size>,
    /// While a player has finished fewer ranked games than this, their tier is
    /// at least `placement_tier`: one lost first game does not demote them.
    placement_games: u8,
    placement_tier: u8,
    /// How long the player a match found waiting has to reveal their squad.
    reveal_limit_ms: u64,
    /// How long after resetting their rating a player can reset it again.
    reset_cooldown_ms: u64,
}

/// The price of an item, and the lowest tier it is unlocked at.
public struct Item has copy, drop, store {
    price: u16,
    min_tier: u8,
}

/// A tier: the ratings from `min_rating` up to the next tier's, and the credits
/// a squad gets, per size, in the order of `Rules.sizes`.
public struct Tier has copy, drop, store {
    min_rating: u64,
    budgets: vector<u16>,
}

/// A size of ranked squads: how many units a side fields, the `Matchmaker` it is
/// queued in, and the level it is played on; none, and it cannot be queued for.
public struct Size has copy, drop, store {
    units: u8,
    queue: ID,
    level: Option<ID>,
}

/// The right to change the `Rules`, given to the publisher.
public struct RulesCap has key, store {
    id: UID,
}

/// The rules to start with, for the package's `init`: the economy of the app, one
/// size for each queue, with its level. Returns the `Rules` and the `RulesCap`.
public(package) fun new(sizes: vector<Size>, ctx: &mut TxContext): (Rules, RulesCap) {
    let rules = Rules {
        id: object::new(ctx),
        version: 1,
        // standard, sharpshooter, plasma
        weapons: vector[item(20, 0), item(40, 1), item(60, 2)],
        // light, medium, heavy
        armor: vector[item(10, 0), item(25, 0), item(45, 2)],
        // frag grenade, flashbang, smoke grenade
        utilities: vector[item(10, 0), item(10, 0), item(10, 0)],
        // rookie, contractor, operative, elite; budgets for 3 and 4 units
        tiers: vector[
            Tier { min_rating: 0, budgets: vector[125, 165] },
            Tier { min_rating: 1400, budgets: vector[150, 200] },
            Tier { min_rating: 1650, budgets: vector[190, 255] },
            Tier { min_rating: 1900, budgets: vector[240, 320] },
        ],
        sizes,
        placement_games: 5,
        placement_tier: 1,
        reveal_limit_ms: 60_000,
        reset_cooldown_ms: 7 * 86_400_000,
    };
    (rules, RulesCap { id: object::new(ctx) })
}

/// An item at `price`, unlocked from `min_tier`.
fun item(price: u16, min_tier: u8): Item { Item { price, min_tier } }

/// A size of `units` a side, queued in `queue` and played on `level`.
public(package) fun new_size(units: u8, queue: ID, level: Option<ID>): Size {
    Size { units, queue, level }
}

/// Share the `Rules`.
public(package) fun share(self: Rules) { transfer::share_object(self) }

// === Ranked ===

/// Check a squad of `size` units for a player of `tier`, aborting in this order:
/// `ESquadSize`; then unit by unit, rifle, armor and utility, `EUnknownItem` and
/// `EItemLocked`; then `EOverBudget`.
public fun check_squad(self: &Rules, size: u8, tier: u8, squad: &vector<u8>) {
    let budget = self.budget(tier, size);
    assert!(squad.length() == 3 * (size as u64), ESquadSize);

    let mut total = 0;
    (size as u64).do!(|i| {
        let utility = squad[3 * i + 2];
        total = total + price(&self.weapons, squad[3 * i], 1, tier);
        total = total + price(&self.armor, squad[3 * i + 1], 1, tier);
        if (utility != NO_UTILITY) total = total + price(&self.utilities, utility, 0, tier);
    });
    assert!(total <= budget, EOverBudget);
}

/// The tier of a player with `rating` who has finished `games` ranked games: the
/// highest whose `min_rating` the rating reaches, and while the games are fewer
/// than `placement_games`, no lower than `placement_tier`.
public fun tier_of(self: &Rules, rating: u64, games: u64): u8 {
    let mut tier = 0;
    self.tiers.length().do!(|i| if (self.tiers[i].min_rating <= rating) tier = i);
    if (games < (self.placement_games as u64)) tier = tier.max(self.placement_tier as u64);
    tier as u8
}

/// The credits a squad of `size` gets at `tier`.
public fun budget(self: &Rules, tier: u8, size: u8): u64 {
    self.tiers[tier as u64].budgets[self.size_index(size)] as u64
}

/// The size whose queue is `queue`. Aborts with `EWrongQueue` if there is none.
public fun size_of(self: &Rules, queue: ID): u8 {
    let i = self.sizes.find_index!(|s| s.queue == queue).destroy_or!(abort EWrongQueue);
    self.sizes[i].units
}

/// The level a squad of `size` plays on. Aborts with `ENoLevel` if it has none.
public fun level_of(self: &Rules, size: u8): ID {
    self.sizes[self.size_index(size)].level.destroy_or!(abort ENoLevel)
}

/// Get the version of the rules: bumped by every change.
public fun version(self: &Rules): u32 { self.version }

/// Get how long the player a match found waiting has to reveal their squad.
public fun reveal_limit_ms(self: &Rules): u64 { self.reveal_limit_ms }

/// Get how long after a rating reset the next one can be.
public fun reset_cooldown_ms(self: &Rules): u64 { self.reset_cooldown_ms }

// === Admin ===

/// Price an item: the one at `index` of the `slot` (`WEAPON`, `ARMOR` or
/// `UTILITY`, see the fields of `Rules`), unlocked from `min_tier`. A `min_tier`
/// past the last tier locks it for everyone.
public fun set_item(
    self: &mut Rules,
    _: &RulesCap,
    slot: u8,
    index: u64,
    price: u16,
    min_tier: u8,
) {
    let items = if (slot == WEAPON) &mut self.weapons
    else if (slot == ARMOR) &mut self.armor
    else if (slot == UTILITY) &mut self.utilities
    else abort EUnknownItem;
    assert!(index < items.length(), EUnknownItem);

    *&mut items[index] = Item { price, min_tier };
    self.version = self.version + 1;
}

/// Set the tier at `index`: its lowest rating, which keeps the tiers in order,
/// and its budget for each size. The first tier's lowest rating is where the
/// ratings start: anything below it is in the first tier all the same.
public fun set_tier(
    self: &mut Rules,
    _: &RulesCap,
    index: u64,
    min_rating: u64,
    budgets: vector<u16>,
) {
    let count = self.tiers.length();
    assert!(index < count && budgets.length() == self.sizes.length(), EBadTier);
    assert!(index == 0 || self.tiers[index - 1].min_rating < min_rating, EBadTier);
    assert!(index + 1 == count || min_rating < self.tiers[index + 1].min_rating, EBadTier);

    *&mut self.tiers[index] = Tier { min_rating, budgets };
    self.version = self.version + 1;
}

/// Set the numbers: the placement games and tier, how long a revealer has, and
/// the cooldown of a rating reset.
public fun set_numbers(
    self: &mut Rules,
    _: &RulesCap,
    placement_games: u8,
    placement_tier: u8,
    reveal_limit_ms: u64,
    reset_cooldown_ms: u64,
) {
    assert!((placement_tier as u64) < self.tiers.length(), EBadTier);

    self.placement_games = placement_games;
    self.placement_tier = placement_tier;
    self.reveal_limit_ms = reveal_limit_ms;
    self.reset_cooldown_ms = reset_cooldown_ms;
    self.version = self.version + 1;
}

/// Play squads of `size` on `level`, which `ghosts::set_level` checked has room.
public(package) fun set_level_id(self: &mut Rules, _: &RulesCap, size: u8, level: ID) {
    let i = self.size_index(size);
    self.sizes[i].level = option::some(level);
    self.version = self.version + 1;
}

// === Internal ===

/// The index of `size` in `Rules.sizes`. Aborts with `ENoSize` if there is none.
fun size_index(self: &Rules, size: u8): u64 {
    self.sizes.find_index!(|s| s.units == size).destroy_or!(abort ENoSize)
}

/// The price of the item a unit's `byte` names among `items`, whose first is
/// named `first`, for a player of `tier`: `EUnknownItem` if there is none,
/// `EItemLocked` if it is above the tier.
fun price(items: &vector<Item>, byte: u8, first: u8, tier: u8): u64 {
    assert!(byte >= first && ((byte - first) as u64) < items.length(), EUnknownItem);
    let item = items[(byte - first) as u64];
    assert!(item.min_tier <= tier, EItemLocked);
    item.price as u64
}

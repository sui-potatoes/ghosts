// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/// Generic rating-based matchmaking for two-player games.
///
/// A game package creates a `Matchmaker<T>` for a type `T` it defines, proving
/// ownership with `internal::Permit<T>`, and shares it. Players enter the queue
/// through `find_game`, which either pairs the caller with a compatible waiting
/// player and returns a `Match`, or leaves a `Ticket` in the queue. Either way
/// the call gets an order ID, and a `Match` carries the ID of the waiting
/// player's order. A waiting player bails out with `cancel_game`.
///
/// The opponent is drawn at random among the compatible tickets of the nearest
/// buckets, so a player cannot steer who they are paired with by timing their
/// call. The game creates the `RandomGenerator` from `sui::random::Random` in a
/// non-public `entry` function, so the draw cannot be inspected and reverted
/// within the same transaction.
///
/// The matchmaker knows nothing about how ratings are computed or stored. The
/// caller passes the player's `rating` and a `window`, the tolerance in rating
/// points this player accepts right now (for example their rating deviation).
/// Two tickets are compatible when `|r_a - r_b| <= window_a + window_b`, where
/// each window additionally grows with the time waited, as set in `Config`.
///
/// Storage: tickets live in dynamic fields keyed by rating bucket, each bucket
/// a small capped vector. A `u256` bitmap in the shared object records which
/// buckets are non-empty, so a `find_game` call loads a dynamic field only when
/// it is known to hold tickets. The shared object stays constant in size and
/// the cost of a call is bounded by `Config`, not by the number of players.
module matchmaker::matchmaker;

use sui::{clock::Clock, dynamic_field as df, random::RandomGenerator, table::{Self, Table}};

/// Sender already has a live ticket in the queue.
const EAlreadyQueued: u64 = 0;
/// Sender has no ticket in the queue.
const ENotQueued: u64 = 1;
/// Config has a zero size, capacity or interval.
const EInvalidConfig: u64 = 2;
/// Config can only be replaced while the queue is empty.
const EQueueNotEmpty: u64 = 3;

/// Highest bucket index; ratings at or above `MAX_BUCKET * bucket_size` share it.
const MAX_BUCKET: u64 = 255;

/// Shared matchmaking queue for the game `T`.
public struct Matchmaker<phantom T> has key {
    id: UID,
    config: Config,
    /// Bit `i` is set while bucket `i` holds tickets.
    occupied: u256,
    /// Waiting player to the bucket holding their ticket.
    players: Table<address, u8>,
    /// Number of waiting tickets.
    size: u64,
}

/// Matchmaking parameters.
public struct Config has copy, drop, store {
    /// Width of a rating bucket in points.
    bucket_size: u64,
    /// Maximum tickets per bucket; the oldest is evicted when a bucket is full.
    bucket_capacity: u64,
    /// Rating points added to a ticket's window per `window_step_ms` waited.
    window_step: u64,
    window_step_ms: u64,
    /// Upper bound of a single ticket's window.
    max_window: u64,
    /// Tickets older than this are dropped when their bucket is next visited.
    ticket_ttl_ms: u64,
}

/// Dynamic field key of a bucket. The value is a `vector<Ticket>`.
public struct Bucket(u8) has copy, drop, store;

/// A player waiting for an opponent.
public struct Ticket has copy, drop, store {
    /// Order ID returned by `find_game`.
    id: ID,
    player: address,
    rating: u64,
    window: u64,
    since_ms: u64,
}

/// Result of a pairing. The first player is the one who waited, and the ID is
/// the one of their order.
public struct Match has copy, drop, store {
    id: ID,
    players: vector<address>,
}

// === Setup ===

/// Create a matchmaker for the game identified by `T`. The `Permit` proves the
/// caller is the module defining `T`.
public fun new<T>(_: internal::Permit<T>, config: Config, ctx: &mut TxContext): Matchmaker<T> {
    Matchmaker {
        id: object::new(ctx),
        config,
        occupied: 0,
        players: table::new(ctx),
        size: 0,
    }
}

/// Share the matchmaker.
public fun share<T>(mm: Matchmaker<T>) { transfer::share_object(mm) }

/// Replace the matchmaking parameters. Only allowed while the queue is empty,
/// because buckets are keyed by `bucket_size`.
public fun set_config<T>(_: internal::Permit<T>, mm: &mut Matchmaker<T>, config: Config) {
    assert!(mm.size == 0, EQueueNotEmpty);
    mm.config = config;
}

/// Create a `Config`.
public fun new_config(
    bucket_size: u64,
    bucket_capacity: u64,
    window_step: u64,
    window_step_ms: u64,
    max_window: u64,
    ticket_ttl_ms: u64,
): Config {
    assert!(
        bucket_size > 0 && bucket_capacity > 0 && window_step_ms > 0 && ticket_ttl_ms > 0,
        EInvalidConfig,
    );
    Config { bucket_size, bucket_capacity, window_step, window_step_ms, max_window, ticket_ttl_ms }
}

/// Buckets of 100 points holding up to 32 tickets; window grows by 50 points
/// every 30 seconds up to 1000 points; tickets expire after 10 minutes.
public fun default_config(): Config {
    Config {
        bucket_size: 100,
        bucket_capacity: 32,
        window_step: 50,
        window_step_ms: 30_000,
        max_window: 1_000,
        ticket_ttl_ms: 600_000,
    }
}

// === Matchmaking ===

/// Look for an opponent. Returns the sender's order ID, and a `Match` when a
/// compatible player is already waiting; otherwise the sender is queued under
/// that order ID.
///
/// `rating` is the caller's current rating and `window` the number of rating
/// points they are willing to deviate right now (before growth from waiting).
/// Non-empty buckets are visited nearest first and the search stops at the
/// first ring holding compatible tickets. The opponent is drawn from them at
/// random: one of the closest within bucket granularity, but not one the
/// caller can pick.
///
/// Aborts if the sender already has a live ticket; an expired one is replaced.
#[allow(lint(public_random))]
public fun find_game<T>(
    _: internal::Permit<T>,
    mm: &mut Matchmaker<T>,
    rng: &mut RandomGenerator,
    clock: &Clock,
    rating: u64,
    window: u64,
    ctx: &mut TxContext,
): (ID, Option<Match>) {
    let player = ctx.sender();
    let now = clock.timestamp_ms();

    if (mm.players.contains(player)) {
        let bucket = mm.players[player];
        let old = mm.take(bucket, player);
        assert!(mm.config.is_expired(&old, now), EAlreadyQueued);
    };

    let id = ctx.fresh_object_address().to_id();
    let ticket = Ticket { id, player, rating, window, since_ms: now };
    let window = mm.config.window(&ticket, now);
    let center = mm.config.bucket_of(rating) as u64;
    // farthest ring a compatible ticket can sit in
    let reach = ((window + mm.config.max_window) / mm.config.bucket_size + 1).min(MAX_BUCKET);

    // occupied buckets within reach the walk has yet to visit
    let all = 0u256.bitwise_not();
    let low = if (center > reach) center - reach else 0;
    let high = (center + reach).min(MAX_BUCKET);
    let mut pending = mm.occupied & (all << (low as u8)) & (all >> ((MAX_BUCKET - high) as u8));

    // indices of the compatible tickets in the bucket below and the one above
    let (mut below, mut above) = (vector[], vector[]);
    let mut d = 0;
    while (pending != 0 && below.is_empty() && above.is_empty()) {
        if (d <= center) {
            let bit = 1u256 << ((center - d) as u8);
            if (pending & bit != 0) {
                pending = pending ^ bit;
                below = mm.scan_bucket((center - d) as u8, rating, window, now);
            };
        };
        if (d > 0 && center + d <= MAX_BUCKET) {
            let bit = 1u256 << ((center + d) as u8);
            if (pending & bit != 0) {
                pending = pending ^ bit;
                above = mm.scan_bucket((center + d) as u8, rating, window, now);
            };
        };
        d = d + 1;
    };

    let count = below.length() + above.length();
    if (count == 0) {
        mm.insert(ticket);
        return (id, option::none())
    };

    // the walk stopped one ring past the candidates
    let ring = d - 1;
    let pick = rng.generate_u64_in_range(0, count - 1);
    let opponent = if (pick < below.length()) {
        mm.take_at((center - ring) as u8, below[pick])
    } else {
        mm.take_at((center + ring) as u8, above[pick - below.length()])
    };

    (id, option::some(Match { id: opponent.id, players: vector[opponent.player, player] }))
}

/// Leave the queue. Aborts if the sender is not queued.
public fun cancel_game<T>(mm: &mut Matchmaker<T>, ctx: &mut TxContext) {
    mm.leave(ctx.sender());
}

/// Remove a player's ticket whoever the sender is. The `Permit` leaves the
/// decision to the module defining `T`, for example to clear a search that
/// timed out. Aborts if the player is not queued.
public fun remove_ticket<T>(_: internal::Permit<T>, mm: &mut Matchmaker<T>, player: address) {
    mm.leave(player);
}

// === Reads ===

/// Whether a player has a ticket in the queue. Expired tickets count until
/// their bucket is next visited.
public fun is_queued<T>(mm: &Matchmaker<T>, player: address): bool {
    mm.players.contains(player)
}

/// Number of waiting tickets, including expired ones not yet pruned.
public fun queue_length<T>(mm: &Matchmaker<T>): u64 { mm.size }

/// Current matchmaking parameters.
public fun config<T>(mm: &Matchmaker<T>): Config { mm.config }

/// ID of the waiting player's order.
public fun match_id(m: &Match): ID { m.id }

/// The two paired players, the one who waited first.
public fun players(m: &Match): vector<address> { m.players }

#[test_only]
/// Bitmap of non-empty buckets.
public fun occupied<T>(mm: &Matchmaker<T>): u256 { mm.occupied }

// === Internal ===

/// Take a player's ticket out of the queue; aborts if they have none.
fun leave<T>(mm: &mut Matchmaker<T>, player: address) {
    assert!(mm.players.contains(player), ENotQueued);
    let bucket = mm.players[player];
    mm.take(bucket, player);
}

/// Bucket a rating falls into; everything above the range shares the top one.
fun bucket_of(config: &Config, rating: u64): u8 {
    (rating / config.bucket_size).min(MAX_BUCKET) as u8
}

/// Rating window of a ticket at `now`: its own window plus growth for waiting.
fun window(config: &Config, ticket: &Ticket, now: u64): u64 {
    let waited = now - ticket.since_ms;
    (ticket.window + waited / config.window_step_ms * config.window_step).min(config.max_window)
}

fun is_expired(config: &Config, ticket: &Ticket, now: u64): bool {
    now - ticket.since_ms > config.ticket_ttl_ms
}

fun is_occupied<T>(mm: &Matchmaker<T>, bucket: u64): bool {
    mm.occupied & (1u256 << (bucket as u8)) != 0
}

/// Drop the expired tickets of an occupied bucket and return the indices of
/// the rest compatible with the caller, in a single pass. Removes the bucket
/// if it ends up empty.
fun scan_bucket<T>(
    mm: &mut Matchmaker<T>,
    bucket: u8,
    rating: u64,
    window: u64,
    now: u64,
): vector<u64> {
    let Config { window_step, window_step_ms, max_window, ticket_ttl_ms, .. } = mm.config;
    let tickets: &mut vector<Ticket> = df::borrow_mut(&mut mm.id, Bucket(bucket));
    let mut compatible = vector[];
    let mut len = tickets.length();
    let mut i = 0;
    while (i < len) {
        let t = &tickets[i];
        let waited = now - t.since_ms;
        if (waited > ticket_ttl_ms) {
            let Ticket { player, .. } = tickets.remove(i);
            mm.players.remove(player);
            mm.size = mm.size - 1;
            len = len - 1;
        } else {
            let grown = t.window + waited / window_step_ms * window_step;
            let limit = window + if (grown < max_window) grown else max_window;
            let diff = if (rating > t.rating) rating - t.rating else t.rating - rating;
            if (diff <= limit) compatible.push_back(i);
            i = i + 1;
        }
    };

    let is_empty = tickets.is_empty();
    if (is_empty) mm.remove_bucket(bucket);
    compatible
}

/// Store a ticket in its bucket, evicting the oldest one if the bucket is full.
fun insert<T>(mm: &mut Matchmaker<T>, ticket: Ticket) {
    let bucket = mm.config.bucket_of(ticket.rating);
    let capacity = mm.config.bucket_capacity;
    mm.players.add(ticket.player, bucket);
    mm.size = mm.size + 1;

    if (!mm.is_occupied(bucket as u64)) {
        df::add(&mut mm.id, Bucket(bucket), vector[ticket]);
        mm.occupied = mm.occupied | (1u256 << bucket);
        return
    };

    let tickets: &mut vector<Ticket> = df::borrow_mut(&mut mm.id, Bucket(bucket));
    if (tickets.length() >= capacity) {
        let Ticket { player, .. } = tickets.remove(0);
        mm.players.remove(player);
        mm.size = mm.size - 1;
    };
    tickets.push_back(ticket);
}

/// Remove a player's ticket from a bucket. Removes the bucket if it ends up
/// empty.
fun take<T>(mm: &mut Matchmaker<T>, bucket: u8, player: address): Ticket {
    let tickets: &mut vector<Ticket> = df::borrow_mut(&mut mm.id, Bucket(bucket));
    let index = tickets.find_index!(|t| t.player == player).destroy_some();
    let ticket = tickets.remove(index);
    let is_empty = tickets.is_empty();

    if (is_empty) mm.remove_bucket(bucket);
    mm.players.remove(player);
    mm.size = mm.size - 1;
    ticket
}

/// Remove the ticket at `index` of a bucket. Removes the bucket if it ends up
/// empty.
fun take_at<T>(mm: &mut Matchmaker<T>, bucket: u8, index: u64): Ticket {
    let tickets: &mut vector<Ticket> = df::borrow_mut(&mut mm.id, Bucket(bucket));
    let ticket = tickets.remove(index);
    let is_empty = tickets.is_empty();

    if (is_empty) mm.remove_bucket(bucket);
    mm.players.remove(ticket.player);
    mm.size = mm.size - 1;
    ticket
}

/// Delete an empty bucket and clear its bit.
fun remove_bucket<T>(mm: &mut Matchmaker<T>, bucket: u8) {
    let _: vector<Ticket> = df::remove(&mut mm.id, Bucket(bucket));
    mm.occupied = mm.occupied & (1u256 << bucket).bitwise_not();
}

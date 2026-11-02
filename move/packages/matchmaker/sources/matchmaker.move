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

use sui::{clock::Clock, dynamic_field as df, event, random::RandomGenerator, table::{Self, Table}};

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

/// Two players were paired.
public struct MatchFound has copy, drop {
    match_id: ID,
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
    rating: u64,
    window: u64,
    rng: &mut RandomGenerator,
    clock: &Clock,
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

    let mut candidates = vector[];
    let mut d = 0;
    while (d <= reach && candidates.is_empty()) {
        if (d <= center && mm.is_occupied(center - d)) {
            candidates.append(mm.scan_bucket((center - d) as u8, rating, window, now));
        };
        if (d > 0 && center + d <= MAX_BUCKET && mm.is_occupied(center + d)) {
            candidates.append(mm.scan_bucket((center + d) as u8, rating, window, now));
        };
        d = d + 1;
    };

    if (candidates.is_empty()) {
        mm.insert(ticket);
        return (id, option::none())
    };

    let opponent = candidates[rng.generate_u64_in_range(0, candidates.length() - 1)];
    let bucket = mm.config.bucket_of(opponent.rating);
    mm.take(bucket, opponent.player);

    let players = vector[opponent.player, player];

    event::emit(MatchFound { match_id: opponent.id, players });
    (id, option::some(Match { id: opponent.id, players }))
}

/// Leave the queue. Aborts if the sender is not queued.
public fun cancel_game<T>(mm: &mut Matchmaker<T>, ctx: &mut TxContext) {
    let player = ctx.sender();
    assert!(mm.players.contains(player), ENotQueued);
    let bucket = mm.players[player];
    mm.take(bucket, player);
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

/// ID of the waiting player's order, also carried by the `MatchFound` event.
public fun match_id(m: &Match): ID { m.id }

/// The two paired players, the one who waited first.
public fun players(m: &Match): vector<address> { m.players }

#[test_only]
/// Bitmap of non-empty buckets.
public fun occupied<T>(mm: &Matchmaker<T>): u256 { mm.occupied }

// === Internal ===

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

/// Prune an occupied bucket, then return its tickets compatible with the
/// caller.
fun scan_bucket<T>(
    mm: &mut Matchmaker<T>,
    bucket: u8,
    rating: u64,
    window: u64,
    now: u64,
): vector<Ticket> {
    mm.prune_bucket(bucket, now);
    if (!mm.is_occupied(bucket as u64)) return vector[];

    let tickets: &vector<Ticket> = df::borrow(&mm.id, Bucket(bucket));
    let mut compatible = vector[];
    tickets.do_ref!(|t| {
        if (rating.diff(t.rating) <= window + mm.config.window(t, now)) compatible.push_back(*t);
    });
    compatible
}

/// Drop expired tickets of an occupied bucket, keeping the order of the rest.
/// Removes the bucket if it ends up empty.
fun prune_bucket<T>(mm: &mut Matchmaker<T>, bucket: u8, now: u64) {
    let ttl = mm.config.ticket_ttl_ms;
    let tickets: &mut vector<Ticket> = df::borrow_mut(&mut mm.id, Bucket(bucket));
    let mut i = 0;
    while (i < tickets.length()) {
        if (now - tickets[i].since_ms > ttl) {
            let Ticket { player, .. } = tickets.remove(i);
            mm.players.remove(player);
            mm.size = mm.size - 1;
        } else i = i + 1;
    };

    let is_empty = tickets.is_empty();
    if (is_empty) mm.remove_bucket(bucket);
}

/// Store a ticket in its bucket, evicting the oldest one if the bucket is full.
fun insert<T>(mm: &mut Matchmaker<T>, ticket: Ticket) {
    let bucket = mm.config.bucket_of(ticket.rating);
    let capacity = mm.config.bucket_capacity;
    if (!mm.is_occupied(bucket as u64)) {
        df::add(&mut mm.id, Bucket(bucket), vector<Ticket>[]);
        mm.occupied = mm.occupied | (1u256 << bucket);
    };

    let tickets: &mut vector<Ticket> = df::borrow_mut(&mut mm.id, Bucket(bucket));
    if (tickets.length() >= capacity) {
        let Ticket { player, .. } = tickets.remove(0);
        mm.players.remove(player);
        mm.size = mm.size - 1;
    };

    tickets.push_back(ticket);
    mm.players.add(ticket.player, bucket);
    mm.size = mm.size + 1;
}

/// Remove a player's ticket from a bucket. Removes the bucket if it ends up
/// empty.
fun take<T>(mm: &mut Matchmaker<T>, bucket: u8, player: address): Ticket {
    let tickets: &mut vector<Ticket> = df::borrow_mut(&mut mm.id, Bucket(bucket));
    let idx = tickets.find_index!(|t| t.player == player).destroy_some();
    let ticket = tickets.remove(idx);
    let is_empty = tickets.is_empty();

    if (is_empty) mm.remove_bucket(bucket);
    mm.players.remove(player);
    mm.size = mm.size - 1;
    ticket
}

/// Delete an empty bucket and clear its bit.
fun remove_bucket<T>(mm: &mut Matchmaker<T>, bucket: u8) {
    let _: vector<Ticket> = df::remove(&mut mm.id, Bucket(bucket));
    mm.occupied = mm.occupied & (1u256 << bucket).bitwise_not();
}

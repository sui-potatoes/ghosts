// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/// Lobbies for friendly games: one shared `Lobbies`, every lobby a dynamic field on
/// it. A lobby is a pairing and no more: its size, and in an open lobby the guest
/// in its slot and whoever the host kicked out of it. The rest another object
/// says. The host's `Account` is `Searching` with the lobby's key as its order, and
/// since when, which the lobby's lifetime runs from; the key of an open lobby is
/// the host.
///
/// An `Open` lobby is listed, keyed by the host's `Account` ID, so there is one per
/// `Account`. Anyone can take its guest slot, and is `Searching` in it until the
/// host starts the game, or kicks them out, for good. A `Protected` lobby is keyed
/// by the invite code only the host's client knows, hashed twice: the client sends
/// the hash of the code, and the key is its hash, so that no host can pick a key
/// that is someone else's order. Whoever brings the code starts the game there and
/// then: the code is the permission.
///
/// The host can close the lobby at any time, and anyone can once its lifetime is
/// out, the guest kicked first, so that no `Account` is ever left `Searching` in a
/// lobby that is gone. The calls are in `ghosts::ghosts`, which starts the games.
module ghosts::lobby;

use ghosts::account::Account;
use sui::{address, dynamic_field as df, hash};

/// A lobby cannot have this size.
const EWrongSize: u64 = 0;
/// A lobby is open under this key already.
const EKeyTaken: u64 = 1;
/// There is no such lobby.
const ENoLobby: u64 = 2;
/// The `Account` passed as the host does not host the lobby.
const EWrongHost: u64 = 3;
/// The lobby's lifetime is out: nobody can join or start it any more.
const ELobbyExpired: u64 = 4;
/// The guest slot of the lobby is taken.
const ELobbyFull: u64 = 5;
/// The host kicked the `Account` out of the lobby: it cannot come back.
const EKicked: u64 = 6;
/// The lobby has no guest.
const ENoGuest: u64 = 7;
/// The `Account` is not the lobby's guest.
const EWrongGuest: u64 = 8;
/// Only the host can do this before the lobby's lifetime is out.
const ELobbyNotExpired: u64 = 9;
/// The lobby has a guest: kick them first, in the same transaction.
const ELobbyHasGuest: u64 = 10;

/// How long a lobby lasts, from the host's opening it. Past it, nobody can join or
/// start it, and anyone can close it.
const LOBBY_LIFETIME_MS: u64 = 600_000;
/// How many kicked `Account`s an open lobby keeps out; past it, the oldest kick is
/// forgotten.
const MAX_KICKED: u64 = 16;
/// The smallest size a lobby can have: the most recruits each side deploys.
const MIN_SIZE: u8 = 3;
/// The largest size a lobby can have.
const MAX_SIZE: u8 = 4;

/// The lobbies, shared, one per package. Every lobby is a dynamic field on it.
public struct Lobbies has key {
    id: UID,
}

/// Key of a listed lobby: the host's `Account` ID.
public struct Open(ID) has copy, drop, store;

/// Key of an invite-only lobby: the hash of the hash of the invite code.
public struct Protected(address) has copy, drop, store;

/// A lobby, under either key, until the game starts or the lobby closes.
public struct Lobby has store {
    /// The most recruits each side deploys in the game.
    size: u8,
    /// The `Account` waiting in an open lobby for the host to start.
    guest: Option<ID>,
    /// The `Account`s the host of an open lobby kicked out of it.
    kicked: vector<ID>,
}

/// Create the `Lobbies`, for the package's `init`.
public(package) fun new(ctx: &mut TxContext): Lobbies {
    Lobbies { id: object::new(ctx) }
}

/// Share the `Lobbies`.
public(package) fun share(self: Lobbies) { transfer::share_object(self) }

// === Lobbies ===

/// Open a lobby of `size` for the `host`: listed without a `code_hash`, invite-only
/// with one, the hash of the invite code. The `host` is `Searching` in it from `now`.
public(package) fun open(
    self: &mut Lobbies,
    host: &mut Account,
    size: u8,
    code_hash: Option<address>,
    now: u64,
) {
    assert!(size >= MIN_SIZE && size <= MAX_SIZE, EWrongSize);

    let lobby = Lobby { size, guest: option::none(), kicked: vector[] };
    let order = if (code_hash.is_some()) {
        let key = protected(code_hash.destroy_some());
        self.add(key, lobby);
        key.0.to_id()
    } else {
        let key = Open(object::id(host));
        self.add(key, lobby);
        key.0
    };

    host.start_search(order, now);
}

/// Join the invite-only lobby the `code` opens, which the `host` holds: the lobby
/// is gone, and its size is returned, for the game to start.
public(package) fun join_protected(
    self: &mut Lobbies,
    host: &Account,
    code: vector<u8>,
    now: u64,
): u8 {
    let key = protected(address::from_bytes(hash::blake2b256(&code)));
    assert!(df::exists(&self.id, key), ENoLobby);
    assert!(host.search_order() == option::some(key.0.to_id()), EWrongHost);
    assert!(!expired(host, now), ELobbyExpired);

    let Lobby { size, .. } = df::remove(&mut self.id, key);
    size
}

/// Take the guest slot of the `host`'s open lobby: the `guest` is `Searching` in
/// it from `now`, until the host starts the game or kicks them, or they leave.
public(package) fun join_open(self: &mut Lobbies, host: &Account, guest: &mut Account, now: u64) {
    let key = Open(object::id(host));
    assert!(df::exists(&self.id, key), ENoLobby);
    assert!(!expired(host, now), ELobbyExpired);

    let id = object::id(guest);
    let lobby: &mut Lobby = df::borrow_mut(&mut self.id, key);
    assert!(lobby.guest.is_none(), ELobbyFull);
    assert!(!lobby.kicked.contains(&id), EKicked);

    lobby.guest.fill(id);
    guest.start_search(key.0, now);
}

/// The `guest` leaves the open lobby it waits in, whose host is its search order.
public(package) fun leave(self: &mut Lobbies, guest: &mut Account) {
    let host = guest.search_order().destroy_or!(abort ENoLobby);
    self.slot(host, guest).guest = option::none();
    guest.clear_search();
}

/// Kick the `guest` out of the `host`'s open lobby: by the host at any time, which
/// keeps the guest out for good, or by anyone once the lifetime is out, which
/// does not.
public(package) fun kick(
    self: &mut Lobbies,
    host: &Account,
    guest: &mut Account,
    now: u64,
    ctx: &mut TxContext,
) {
    let by_host = ctx.sender() == host.owner();
    let lobby = self.slot(object::id(host), guest);
    assert!(by_host || expired(host, now), ELobbyNotExpired);

    lobby.guest = option::none();
    if (by_host) {
        if (lobby.kicked.length() == MAX_KICKED) {
            lobby.kicked.remove(0);
        };
        lobby.kicked.push_back(object::id(guest));
    };
    guest.clear_search();
}

/// The `host` starts the game of their open lobby with its `guest`: the lobby is
/// gone, and its size is returned, for the game to start.
public(package) fun start(self: &mut Lobbies, host: &Account, guest: &Account, now: u64): u8 {
    let key = Open(object::id(host));
    self.slot(key.0, guest);
    assert!(!expired(host, now), ELobbyExpired);

    let Lobby { size, .. } = df::remove(&mut self.id, key);
    size
}

/// Close the lobby the `host` is `Searching` in, of either kind, with nobody in
/// its guest slot: by the host at any time, by anyone once the lifetime is out.
/// The `host` is idle again.
public(package) fun close(self: &mut Lobbies, host: &mut Account, now: u64, ctx: &mut TxContext) {
    let order = host.search_order().destroy_or!(abort ENoLobby);
    let Lobby { guest, .. } = if (order == object::id(host)) self.remove(Open(order))
    else self.remove(Protected(order.to_address()));

    assert!(ctx.sender() == host.owner() || expired(host, now), ELobbyNotExpired);
    assert!(guest.is_none(), ELobbyHasGuest);
    host.clear_search();
}

// === Internal ===

/// The key of the invite-only lobby whose invite code hashes to `code_hash`.
fun protected(code_hash: address): Protected {
    Protected(address::from_bytes(hash::blake2b256(&code_hash.to_bytes())))
}

/// Whether the lifetime of the lobby the `host` is `Searching` in is out.
fun expired(host: &Account, now: u64): bool {
    host.search_timed_out(now, LOBBY_LIFETIME_MS)
}

/// Add a lobby under a key no lobby has.
fun add<K: copy + drop + store>(self: &mut Lobbies, key: K, lobby: Lobby) {
    assert!(!df::exists(&self.id, key), EKeyTaken);
    df::add(&mut self.id, key, lobby);
}

/// Take out the lobby under a key.
fun remove<K: copy + drop + store>(self: &mut Lobbies, key: K): Lobby {
    assert!(df::exists(&self.id, key), ENoLobby);
    df::remove(&mut self.id, key)
}

/// The open lobby of `host`, with `guest` in its slot.
fun slot(self: &mut Lobbies, host: ID, guest: &Account): &mut Lobby {
    let key = Open(host);
    assert!(df::exists(&self.id, key), ENoLobby);

    let lobby: &mut Lobby = df::borrow_mut(&mut self.id, key);
    assert!(lobby.guest.is_some(), ENoGuest);
    assert!(lobby.guest == option::some(object::id(guest)), EWrongGuest);
    lobby
}

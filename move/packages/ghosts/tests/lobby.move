// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

#[test_only]
extend module ghosts::lobby;

use ghosts::account::{Self, Registry};
use sui::{bcs, test_scenario as ts};

/// How long a lobby lasts.
public fun lifetime_ms(): u64 { LOBBY_LIFETIME_MS }

/// How many kicked `Account`s an open lobby keeps out.
public fun max_kicked(): u64 { MAX_KICKED }

/// The key of the invite-only lobby the invite `code` opens: the hash of its hash.
public fun protected_key(code: vector<u8>): address {
    protected(address::from_bytes(hash::blake2b256(&code))).0
}

/// Whether a lobby is open under either key: the listed one of `host`, or the
/// invite-only one the `code` opens.
public fun is_open(self: &Lobbies, host: ID, code: vector<u8>): bool {
    df::exists(&self.id, Open(host)) || df::exists(&self.id, Protected(protected_key(code)))
}

/// The guest in the listed lobby of `host`.
public fun guest(self: &Lobbies, host: ID): Option<ID> {
    let lobby: &Lobby = df::borrow(&self.id, Open(host));
    lobby.guest
}

/// The `Account`s the host of the listed lobby of `host` kicked out of it.
public fun kicked(self: &Lobbies, host: ID): vector<ID> {
    let lobby: &Lobby = df::borrow(&self.id, Open(host));
    lobby.kicked
}

/// The listed lobby of `host` has kicked `count` made-up `Account`s out already.
public fun fill_kicked(self: &mut Lobbies, host: ID, count: u64, ctx: &mut TxContext) {
    let lobby: &mut Lobby = df::borrow_mut(&mut self.id, Open(host));
    count.do!(|_| lobby.kicked.push_back(ctx.fresh_object_address().to_id()));
}

/// The BCS bytes of a lobby: what its field stores besides the key.
fun bytes<K: copy + drop + store>(self: &Lobbies, key: K): vector<u8> {
    let lobby: &Lobby = df::borrow(&self.id, key);
    bcs::to_bytes(lobby)
}

/// A lobby stores its size, its guest and its kicked list, and nothing else: one
/// byte each while empty, an ID for the guest and for every kick. Once it is
/// gone, so is its field.
#[test]
fun test_lobby_storage() {
    use std::unit_test::assert_eq;

    let (alice, bob, carol) = (@0xA11CE, @0xB0B, @0xCA401);
    let mut ts = ts::begin(@0);
    account::init_for_testing(ts.ctx());
    ts.next_tx(alice);
    let mut registry = ts.take_shared<Registry>();
    registry.new_account(ts.ctx());
    ts.next_tx(bob);
    registry.new_account(ts.ctx());
    ts.next_tx(carol);
    registry.new_account(ts.ctx());

    ts.next_tx(alice);
    let mut lobbies = new(ts.ctx());
    let mut alice = ts.take_shared_by_id<Account>(registry.account_of(alice));
    let mut bob = ts.take_shared_by_id<Account>(registry.account_of(bob));
    let mut carol = ts.take_shared_by_id<Account>(registry.account_of(carol));

    // invite-only: the size and two empty slots, three bytes; the host searches
    // on the key
    let code = x"0102030405060708";
    let code_hash = address::from_bytes(hash::blake2b256(&code));
    lobbies.open(&mut carol, 4, option::some(code_hash), 0);
    let key = Protected(protected_key(code));
    assert_eq!(lobbies.bytes(key), vector[4, 0, 0]);
    assert_eq!(carol.search_order(), option::some(key.0.to_id()));

    // listed, with a guest: an ID more, behind the option's tag
    let host = object::id(&alice);
    lobbies.open(&mut alice, 3, option::none(), 0);
    lobbies.join_open(&alice, &mut bob, 0);
    let mut expected = vector[3, 1];
    expected.append(bcs::to_bytes(&object::id(&bob)));
    expected.push_back(0);
    assert_eq!(lobbies.bytes(Open(host)), expected);
    assert_eq!(lobbies.bytes(Open(host)).length(), 35);

    // kicked: an ID for each, behind the length
    lobbies.kick(&alice, &mut bob, 0, ts.ctx());
    assert_eq!(lobbies.bytes(Open(host)), {
        let mut bytes = vector[3, 0, 1];
        bytes.append(bcs::to_bytes(&object::id(&bob)));
        bytes
    });
    lobbies.fill_kicked(host, MAX_KICKED - 1, ts.ctx());
    assert_eq!(lobbies.bytes(Open(host)).length(), 3 + 32 * MAX_KICKED);

    // closed and started: the fields are gone with the lobbies
    lobbies.close(&mut alice, 0, ts.ctx());
    ts.next_tx(carol.owner());
    lobbies.close(&mut carol, 0, ts.ctx());
    assert!(!df::exists(&lobbies.id, Open(host)));
    assert!(!df::exists(&lobbies.id, key));
    assert!(!df::exists_with_type<Open, Lobby>(&lobbies.id, Open(host)));
    assert!(!df::exists_with_type<Protected, Lobby>(&lobbies.id, key));
    assert!(alice.is_idle() && bob.is_idle() && carol.is_idle());

    let Lobbies { id } = lobbies;
    id.delete();
    ts::return_shared(alice);
    ts::return_shared(bob);
    ts::return_shared(carol);
    ts::return_shared(registry);
    ts.end();
}

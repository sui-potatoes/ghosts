// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The Move calls the SDK makes, in one file so the contract can move under it.
 * They mirror `ghosts::ghosts` and `ghosts::account` in the package source. Only
 * `set_recovery` is still assumed: see "Still assumed" in the README.
 */

import { Transaction } from "@mysten/sui/transactions";

import { codeHash } from "./lobby.ts";
import { ActionError, type Action, type GameState, type ObjectRef } from "./types.ts";

const GAME_MODULE = "ghosts";
const LOBBY_MODULE = "lobby";
const ACCOUNT_MODULE = "account";

export interface Deployment {
    package: string;
    registry: string;
    matchmaker: string;
    /** The frozen `Preset` games are played on, created once on publish. */
    preset: string;
    /** The shared `Lobbies` object friendly games are listed on. */
    lobbies: string;
    names: NameRegistry;
}

/** A `commander-names` instance. */
export interface NameRegistry {
    package: string;
    suins: string;
    instance: string;
    /** The domain the instance holds; a player name is `<name>.<domain>`. */
    domain: string;
}

/** The instance the app uses on testnet, so agents and humans share one namespace. */
export const TESTNET_NAMES: NameRegistry = {
    package: "0x6f2a13d8d3eba4e606b542d3c8b5cb5b69376a271f08c979c107ee89d9345c56",
    suins: "0x300369e8909b9a6464da265b9a5a9ab6fe2158a040e84e808628cde7a07ee5a3",
    instance: "0xbf2ddab4c8c7deabf1461cc0c8fdb7dc2b12c2fd55b65782080a516e7cd7263b",
    domain: "demo.ghosts.sui",
};

/** The package on testnet, the same ids as `GHOSTS` in `app/src/constants.ts`. */
export const TESTNET_DEPLOYMENT: Deployment = {
    package: "0xdbd205dbe67b44f721933e20b95010b8e01c7c1316ff32540d7af4cb46b4246e",
    registry: "0xaa4e35823c515cf91bbcb53311f10d6fccc2d4e4bc148fa8bb7d43f250d79589",
    matchmaker: "0x93791ca35a785341beff57c4d59647e26da06d923c8666e67d204e401dbd017e",
    preset: "0x5e37e87da2aca8ce31b0a2ac918ea76fa376ba9d8c02e61e976d5c9c7c2ebff1",
    lobbies: "0x81afce11aa84fc75c08ebee3565670961002122986396444c32333f7fb72185f",
    names: TESTNET_NAMES,
};

const CLOCK = "0x6";
/** `items::rifle` tier 1: the "Standard Rifle", the one the squad is armed with. */
const STANDARD_RIFLE = 1;
/** `items::utility` kinds, as `requisition_utility` takes them. Only appended. */
export const UTILITY_KINDS = { frag_grenade: 0, flashbang: 1, smoke_grenade: 2 } as const;
export type UtilityName = keyof typeof UTILITY_KINDS;

/**
 * Take `name`, shaped like the app's rename: an earlier leaf of this address is
 * taken back, a current one moves, or the first one is created. It always ends
 * by making the leaf the address's default name, which is what others read.
 */
export function nameChangeTx(
    names: NameRegistry,
    name: string,
    alreadyOurs: boolean,
    current: string | null,
): Transaction {
    const tx = new Transaction();
    const instance = tx.object(names.instance);
    const suins = tx.object(names.suins);
    const call = (fn: string, ...args: ReturnType<typeof tx.pure.string>[]) =>
        tx.moveCall({
            target: `${names.package}::commander_names::${fn}`,
            arguments: [instance, suins, ...args],
        });

    if (alreadyOurs) {
        if (current) call("remove", tx.pure.string(current), tx.object(CLOCK));
    } else if (current) {
        call("rename", tx.pure.string(current), tx.pure.string(name), tx.object(CLOCK));
    } else {
        call("register", tx.pure.string(name), tx.object(CLOCK));
    }
    call("set_default", tx.pure.string(name));
    return tx;
}

export function newAccountTx(d: Deployment): Transaction {
    const tx = new Transaction();
    tx.moveCall({
        target: `${d.package}::${ACCOUNT_MODULE}::new_account`,
        arguments: [tx.object(d.registry)],
    });
    return tx;
}

/** Still assumed: name the wallet that can take the account over. Refused until it exists. */
export function setRecoveryTx(d: Deployment, account: string, wallet: string): Transaction {
    const tx = new Transaction();
    tx.moveCall({
        target: `${d.package}::${ACCOUNT_MODULE}::set_recovery`,
        arguments: [tx.object(account), tx.pure.address(wallet)],
    });
    return tx;
}

export function hireRecruitsTx(d: Deployment, account: string): Transaction {
    const tx = new Transaction();
    tx.moveCall({
        target: `${d.package}::${ACCOUNT_MODULE}::hire_recruits`,
        arguments: [tx.object(account), tx.object(d.registry), tx.object.random()],
    });
    return tx;
}

/**
 * Pair with a compatible waiting player, or leave an order in the queue. A match
 * starts the game in the same call and puts the finder in it; the player who waited
 * is sent a `Seat` and stays on their search until it is accepted.
 */
export function findGameTx(d: Deployment, account: string): Transaction {
    const tx = new Transaction();
    tx.moveCall({
        target: `${d.package}::${GAME_MODULE}::find_game`,
        arguments: [
            tx.object(d.matchmaker),
            tx.object(account),
            tx.object(d.preset),
            tx.object.random(),
            tx.object(CLOCK),
        ],
    });
    return tx;
}

/** Leave the queue. A search a match found is left through its game instead. */
export function cancelSearchTx(d: Deployment, account: string): Transaction {
    const tx = new Transaction();
    tx.moveCall({
        target: `${d.package}::${GAME_MODULE}::cancel_search`,
        arguments: [tx.object(d.matchmaker), tx.object(account), tx.object(CLOCK)],
    });
    return tx;
}

// === Friendly lobbies ===

/**
 * Open a lobby of `size` (3 or 4) for the `Account`: listed (keyed by the `Account`) without a
 * `code`, invite-only with the 8-byte invite code, of which only `blake2b256(code)` is sent. The
 * `Account` is `Searching` in it, for `LOBBY_LIFETIME_MS`, until it starts or closes.
 */
export function openLobbyTx(
    d: Deployment,
    account: string,
    size: number,
    code?: Uint8Array,
): Transaction {
    const tx = new Transaction();
    tx.moveCall({
        target: `${d.package}::${GAME_MODULE}::open_lobby`,
        arguments: [
            tx.object(d.lobbies),
            tx.object(account),
            tx.object(CLOCK),
            tx.pure.u8(size),
            tx.pure.option("address", code ? codeHash(code) : null),
        ],
    });
    return tx;
}

/** Join the invite-only lobby of `host` (its `Account` ID) with the invite code: the game starts at once. */
export function joinLobbyTx(
    d: Deployment,
    account: string,
    host: string,
    code: Uint8Array,
): Transaction {
    const tx = new Transaction();
    tx.moveCall({
        target: `${d.package}::${GAME_MODULE}::join_lobby`,
        arguments: [
            tx.object(d.lobbies),
            tx.object(d.preset),
            tx.object(host),
            tx.object(account),
            tx.object(CLOCK),
            tx.pure.vector("u8", Array.from(code)),
        ],
    });
    return tx;
}

/** Take the guest slot of the listed lobby of `host`, until its host starts it or kicks the guest. */
export function joinOpenTx(d: Deployment, account: string, host: string): Transaction {
    const tx = new Transaction();
    tx.moveCall({
        target: `${d.package}::${GAME_MODULE}::join_open`,
        arguments: [tx.object(d.lobbies), tx.object(host), tx.object(account), tx.object(CLOCK)],
    });
    return tx;
}

/** The guest leaves the listed lobby it waits in. */
export function leaveLobbyTx(d: Deployment, account: string): Transaction {
    const tx = new Transaction();
    tx.moveCall({
        target: `${d.package}::${GAME_MODULE}::leave_lobby`,
        arguments: [tx.object(d.lobbies), tx.object(account)],
    });
    return tx;
}

/** `kick_guest`, as a step of a transaction. */
function kickGuest(d: Deployment, tx: Transaction, host: string, guest: string) {
    tx.moveCall({
        target: `${d.package}::${GAME_MODULE}::kick_guest`,
        arguments: [tx.object(d.lobbies), tx.object(host), tx.object(guest), tx.object(CLOCK)],
    });
}

/** `close_lobby`, as a step of a transaction. */
function closeLobby(d: Deployment, tx: Transaction, host: string) {
    tx.moveCall({
        target: `${d.package}::${GAME_MODULE}::close_lobby`,
        arguments: [tx.object(d.lobbies), tx.object(host), tx.object(CLOCK)],
    });
}

/**
 * Kick `guest` out of the listed lobby of `host`. The host can at any time, and the guest cannot
 * come back; anyone else once the lobby's lifetime is out, which is not recorded.
 */
export function kickGuestTx(d: Deployment, host: string, guest: string): Transaction {
    const tx = new Transaction();
    kickGuest(d, tx, host, guest);
    return tx;
}

/** The host starts the game of its listed lobby with its guest. */
export function startFriendlyTx(d: Deployment, host: string, guest: string): Transaction {
    const tx = new Transaction();
    tx.moveCall({
        target: `${d.package}::${GAME_MODULE}::start_friendly`,
        arguments: [
            tx.object(d.lobbies),
            tx.object(d.preset),
            tx.object(host),
            tx.object(guest),
            tx.object(CLOCK),
        ],
    });
    return tx;
}

/** Close the lobby `host` hosts, of either kind, with nobody in its slot: the host at any time. */
export function closeLobbyTx(d: Deployment, host: string): Transaction {
    const tx = new Transaction();
    closeLobby(d, tx, host);
    return tx;
}

/**
 * Close a lobby with a guest in it: kick, then close, in one transaction. The host can do it at
 * any time (the guest is recorded as kicked); anyone can once the lobby's lifetime is out (the
 * guest is not recorded). Both `Account`s end idle and the lobby is gone.
 */
export function closeLobbyWithGuestTx(d: Deployment, host: string, guest: string): Transaction {
    const tx = new Transaction();
    kickGuest(d, tx, host, guest);
    closeLobby(d, tx, host);
    return tx;
}

/** A `Seat` sent to an `Account` and still to be accepted, by the reference that receives it. */
export interface PendingSeat {
    account: string;
    seat: ObjectRef;
    /** The game the seat is in, when known. */
    game?: string;
}

/** `accept_seat`: put the `Account` into the game its `Seat` is in. Anyone can send it. */
function acceptSeat(d: Deployment, tx: Transaction, { account, seat }: PendingSeat) {
    tx.moveCall({
        target: `${d.package}::${GAME_MODULE}::accept_seat`,
        arguments: [tx.object(account), tx.receivingRef(seat)],
    });
}

export function acceptSeatsTx(d: Deployment, seats: PendingSeat[]): Transaction {
    const tx = new Transaction();
    for (const seat of seats) acceptSeat(d, tx, seat);
    return tx;
}

/** What a recruit at home still lacks to play: a weapon, or a utility for its free slot. */
export interface Fitting {
    recruit: ObjectRef;
    rifle: boolean;
    /** Whether the free utility slot needs filling. */
    grenade: boolean;
    /** What goes in it: the frag grenade unless said. The slot takes one utility. */
    utility?: UtilityName;
}

/**
 * Arm recruits at home as the armory does: a hire carries a Standard Rifle but no utility,
 * and a recruit whose rifle was taken off has no `Attack` or `Reload` once on the map. Each
 * standard rifle and utility (a frag grenade, a flashbang or a smoke grenade) is requisitioned,
 * equipped while the recruit is borrowed and handed back, in one transaction.
 */
export function armSquadTx(d: Deployment, account: string, fittings: Fitting[]): Transaction {
    const tx = new Transaction();
    const target = (fn: string) => `${d.package}::${ACCOUNT_MODULE}::${fn}`;
    const acc = tx.object(account);
    for (const { recruit, rifle: needsRifle, grenade: needsGrenade, utility } of fittings) {
        const [borrowed, borrow] = tx.moveCall({
            target: target("borrow_recruit"),
            arguments: [acc, tx.receivingRef(recruit)],
        });
        if (needsRifle) {
            const [rifle] = tx.moveCall({
                target: target("requisition_rifle"),
                arguments: [acc, tx.pure.u8(STANDARD_RIFLE)],
            });
            tx.moveCall({ target: target("equip_weapon"), arguments: [borrowed, rifle] });
        }
        if (needsGrenade) {
            const [grenade] = tx.moveCall({
                target: target("requisition_utility"),
                arguments: [acc, tx.pure.u8(UTILITY_KINDS[utility ?? "frag_grenade"])],
            });
            tx.moveCall({ target: target("equip_utility"), arguments: [borrowed, grenade] });
        }
        tx.moveCall({ target: target("return_recruit"), arguments: [borrowed, borrow] });
    }
    return tx;
}

/**
 * One transaction for a validated batch. The orders are all `entry fun`, which
 * is what lets a move and a dice roll share a transaction: a private `entry` call
 * refuses an object a plain `public` call already mutated.
 */
export function actionsTx(
    d: Deployment,
    game: GameState,
    account: string,
    actions: Action[],
    seats: PendingSeat[] = [],
): Transaction {
    const tx = new Transaction();
    const call = (fn: string, ...args: Parameters<typeof tx.moveCall>[0]["arguments"] & object) =>
        tx.moveCall({ target: `${d.package}::${GAME_MODULE}::${fn}`, arguments: args });
    const gameObject = () => tx.object(game.id);
    const me = () => tx.object(account);
    const clock = () => tx.object(CLOCK);
    const complete = () =>
        call(
            "complete_game",
            gameObject(),
            tx.object(game.players[0]),
            tx.object(game.players[1]),
            clock(),
        );

    // a seat not yet accepted is accepted first: wrapping up or leaving needs both in
    for (const seat of seats) acceptSeat(d, tx, seat);

    for (const action of actions) {
        switch (action.kind) {
            case "deploy": {
                if (!action.recruits?.length) {
                    throw new ActionError("rejected", "This account has no recruits to deploy.");
                }
                const recruits = tx.makeMoveVec({
                    type: `0x2::transfer::Receiving<${d.package}::recruit::Recruit>`,
                    elements: action.recruits.map((recruit) => tx.receivingRef(recruit)),
                });
                call("deploy_squad", gameObject(), me(), clock(), recruits);
                break;
            }
            case "move":
                call(
                    "move_unit",
                    gameObject(),
                    me(),
                    clock(),
                    tx.pure.vector("u8", [action.x, action.y, ...action.path]),
                );
                break;
            case "reload":
                call(
                    "perform_reload",
                    gameObject(),
                    me(),
                    clock(),
                    tx.pure.u16(action.x),
                    tx.pure.u16(action.y),
                );
                break;
            case "attack":
            case "grenade":
                call(
                    action.kind === "attack" ? "perform_attack" : "perform_grenade",
                    gameObject(),
                    me(),
                    tx.object.random(),
                    clock(),
                    tx.pure.u16(action.x),
                    tx.pure.u16(action.y),
                    tx.pure.u16(action.tx),
                    tx.pure.u16(action.ty),
                );
                break;
            case "flashbang":
            case "smoke_grenade":
                // nothing rolls, so there is no `Random` to pass
                call(
                    action.kind === "flashbang" ? "perform_flashbang" : "perform_smoke_grenade",
                    gameObject(),
                    me(),
                    clock(),
                    tx.pure.u16(action.x),
                    tx.pure.u16(action.y),
                    tx.pure.u16(action.tx),
                    tx.pure.u16(action.ty),
                );
                break;
            case "next_turn":
                call("next_turn", gameObject(), me(), clock());
                break;
            case "complete":
                complete();
                break;
            case "abandon":
                // As the app does: nothing is left to wait for, so wrap up in one go.
                call("abandon_game", gameObject(), me());
                complete();
                break;
        }
    }
    return tx;
}

/** Move abort codes an agent can act on, by module. */
const ABORTS: Record<string, Record<number, string>> = {
    commander_names: {
        3: "That name was taken a moment ago: pick another.",
        5: "That name belongs to another address: pick another.",
    },
    map: {
        1: "A unit already stands on that tile.",
        2: "That tile cannot be walked on.",
        3: "The path is blocked.",
        5: "There is no unit on that tile.",
        6: "The path is too short, or the throw is out of range.",
        7: "That tile is off the map.",
        8: "That tile is a wall.",
        9: "There is no line of sight to the target.",
    },
    unit: {
        1: "The target or destination is out of range.",
        2: "Out of ammo.",
        3: "That unit has no AP left.",
        4: "The weapon is already full.",
        5: "That unit cannot do that: it is not in its actions.",
        6: "That unit has no use left of that grenade.",
    },
    matchmaker: {
        0: "This account already has a live ticket in the queue.",
        1: "This account has no ticket in the queue.",
    },
    [GAME_MODULE]: {
        1: "This account is not a player in that game.",
        4: "That squad doesn't fit: pick at least one recruit, and no more than the spawn positions.",
        6: "This account is already searching or playing.",
        7: "This account is not searching.",
        8: "That search has not timed out yet.",
        9: "This account is suspended: it left a game behind.",
        10: "The game is over: send complete.",
        11: "It is not your turn.",
        12: "Your turn ran out of time: send next_turn.",
        13: "The opponent's turn clock is still running.",
        14: "There is no unit of yours on that tile.",
        15: "The time to deploy is over.",
        16: "The players are still deploying.",
        17: "The game is still running.",
        21: "Your squad is already deployed.",
        22: "This account has no recruits to play with.",
        25: "This account is not in the queue: in a lobby, leave or close it; if a match found its search, accept the seat first.",
        27: "This account has yet to accept its seat in the game.",
        28: "That squad is larger than the friendly game allows.",
    },
    [LOBBY_MODULE]: {
        0: "A lobby has 3 or 4 recruits a side.",
        1: "A lobby is already open under that key: close it, or use another code.",
        2: "There is no such lobby: check the code and the host.",
        3: "That account does not host the lobby the code opens.",
        4: "That lobby has expired.",
        5: "That lobby is full.",
        6: "The host kicked this account out of that lobby.",
        7: "There is no guest in that lobby.",
        8: "That account is not the guest of that lobby.",
        9: "Only the host can do that until the lobby has expired.",
        10: "The lobby has a guest: kick them first, in the same transaction.",
    },
    [ACCOUNT_MODULE]: {
        0: "This address already has an account.",
        1: "This address does not own the account.",
        2: "The squad is already full.",
        3: "That voice does not exist.",
        6: "The squad is in a game.",
        7: "That is not the recruit that was borrowed.",
    },
};

export function abortMessage(module: string | undefined, code: string): string {
    const known = module ? ABORTS[module]?.[Number(code)] : undefined;
    return known ?? `The contract refused the action (${module ?? "unknown"} abort ${code}).`;
}

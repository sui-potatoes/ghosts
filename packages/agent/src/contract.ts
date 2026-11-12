// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The Move calls the SDK makes, in one file so the contract can move under it.
 * They mirror `ghosts::ghosts` and `ghosts::account` in the package source. Only
 * `set_recovery` is still assumed: see "Still assumed" in the README.
 */

import { Transaction } from "@mysten/sui/transactions";

import { ActionError, type Action, type GameState, type ObjectRef } from "./types.ts";

const GAME_MODULE = "ghosts";
const ACCOUNT_MODULE = "account";

export interface Deployment {
    package: string;
    registry: string;
    matchmaker: string;
    /** The frozen `Preset` games are played on, created once on publish. */
    preset: string;
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
    package: "0x2d98340895491cbea1964d14e2c394eba2be907be4f278f966dbe9a3b25e0002",
    registry: "0x4818af61995f3d63602efe6a080d4b3caa781d23a4edda345fd3e56450c39558",
    matchmaker: "0x3ae996767215956e3e74e5d6364ad5cbddd0933aabbd5a2e9cb87a7f7fddc935",
    preset: "0xbf87177f12715adfa48574471f176163ae4ac673dd972ef8f83821446b5265a9",
    names: TESTNET_NAMES,
};

const CLOCK = "0x6";
/** `items::rifle` tier 1: the "Standard Rifle", the one a rank-less recruit may carry. */
const STANDARD_RIFLE = 1;
/** `items::utility` kind 0: the frag grenade. */
const FRAG_GRENADE_KIND = 0;

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
    grenade: boolean;
}

/**
 * Arm recruits at home as the armory does: a recruit hired with no gear has no `Attack`,
 * `Reload` or `Grenade` once on the map. Each standard rifle and frag grenade is requisitioned,
 * equipped while the recruit is borrowed and handed back, in one transaction.
 */
export function armSquadTx(d: Deployment, account: string, fittings: Fitting[]): Transaction {
    const tx = new Transaction();
    const target = (fn: string) => `${d.package}::${ACCOUNT_MODULE}::${fn}`;
    const acc = tx.object(account);
    for (const { recruit, rifle: needsRifle, grenade: needsGrenade } of fittings) {
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
                arguments: [acc, tx.pure.u8(FRAG_GRENADE_KIND)],
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
        6: "Every charge of that unit's grenade is spent.",
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
        25: "A match found this search: accept its seat first.",
        27: "This account has yet to accept its seat in the game.",
    },
    [ACCOUNT_MODULE]: {
        0: "This address already has an account.",
        1: "This address does not own the account.",
        2: "The squad is already full.",
        3: "That voice does not exist.",
        6: "The squad is in a game.",
        7: "That is not the recruit that was borrowed.",
        8: "That recruit's rank is too low for this gear.",
    },
};

export function abortMessage(module: string | undefined, code: string): string {
    const known = module ? ABORTS[module]?.[Number(code)] : undefined;
    return known ?? `The contract refused the action (${module ?? "unknown"} abort ${code}).`;
}

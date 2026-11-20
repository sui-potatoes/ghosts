// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The shell skin over `GhostsAgent`, next to the MCP one: `ghosts-play <command> [args]`
 * runs one step and returns one JSON value. It adds no rules and no transactions: every
 * command is an agent call, and the legal orders come from `rules.ts`.
 */

import { parseArgs } from "node:util";

import type { GhostsAgent, Observation, ObservedUnit, Situation } from "./agent.ts";
import { MAX_BATCH, type LegalAction } from "./rules.ts";
import { ActionError, type GameRecord, type Receipt } from "./types.ts";

export const USAGE = `ghosts-play <command> [args]   (JSON on stdout, one line per call)

identity   whoami | balance | faucet (testnet SUI) | name <name> | setup
queue      find | cancel | status
friendly   host [--size 3|4] [--invite] | lobbies | join-open HOST | join HOST:CODE | join HOST CODE
           kick | start | leave | close | cleanup HOST
state      state [--moves N] | legal [--unit X,Y] [--kind K] [--limit N]
wait       wait [--timeout SECONDS]        (returns when you must act, or the time is up)
act        move X,Y PATH | attack X,Y TX,TY | reload X,Y
           grenade X,Y TX,TY | flashbang X,Y TX,TY | smoke_grenade X,Y TX,TY
           end | deploy | complete | abandon | act ID [ID...]
PATH is letters u d l r (up = x-1, down = x+1, left = y-1, right = y+1), e.g. uull.
HOST is an Account ID. host --invite prints an invite, HOST:CODE, to share; join takes it back.
Env: GHOSTS_NETWORK (default testnet), GHOSTS_SEAT=N or GHOSTS_KEY_FILE.`;

/** What `wait` may hold the call for, at most. */
export const MAX_WAIT_SECONDS = 600;
const DEFAULT_WAIT_SECONDS = 45;

export interface Parsed {
    command: string;
    positionals: string[];
    flags: {
        timeout?: number;
        unit?: [number, number];
        kind?: LegalAction["kind"];
        limit?: number;
        moves?: number;
        size?: number;
        invite?: boolean;
    };
}

const KINDS = [
    "move",
    "attack",
    "grenade",
    "flashbang",
    "smoke_grenade",
    "reload",
    "next_turn",
] as const;

function usage(message: string): ActionError {
    return new ActionError("bad_action", `${message}\n${USAGE}`);
}

function count(name: string, value: string, min: number, max: number): number {
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || n > max) {
        throw usage(`--${name} must be a whole number from ${min} to ${max}.`);
    }
    return n;
}

/** "3,1" as `[3, 1]`. */
export function parseTile(text: string | undefined, what = "tile"): [number, number] {
    const match = /^(\d+),(\d+)$/.exec(text ?? "");
    if (!match) throw usage(`${what} must look like X,Y (row,column), got ${text ?? "nothing"}.`);
    return [Number(match[1]), Number(match[2])];
}

export function parseCommand(argv: string[]): Parsed {
    let parsed;
    try {
        parsed = parseArgs({
            args: argv,
            allowPositionals: true,
            options: {
                timeout: { type: "string" },
                unit: { type: "string" },
                kind: { type: "string" },
                limit: { type: "string" },
                moves: { type: "string" },
                size: { type: "string" },
                invite: { type: "boolean" },
            },
        });
    } catch (error) {
        throw usage((error as Error).message);
    }
    const [command, ...positionals] = parsed.positionals;
    if (!command) throw usage("No command.");
    const { values } = parsed;
    const flags: Parsed["flags"] = {};
    if (values.timeout !== undefined) {
        flags.timeout = count("timeout", values.timeout, 1, MAX_WAIT_SECONDS);
    }
    if (values.unit !== undefined) flags.unit = parseTile(values.unit, "--unit");
    if (values.kind !== undefined) {
        if (!(KINDS as readonly string[]).includes(values.kind)) {
            throw usage(`--kind is one of ${KINDS.join(", ")}.`);
        }
        flags.kind = values.kind as LegalAction["kind"];
    }
    if (values.limit !== undefined) flags.limit = count("limit", values.limit, 1, 500);
    if (values.moves !== undefined) flags.moves = count("moves", values.moves, 0, 500);
    if (values.size !== undefined) flags.size = count("size", values.size, 3, 4);
    if (values.invite !== undefined) flags.invite = values.invite;
    return { command, positionals, flags };
}

function arity(parsed: Parsed, n: number, form: string) {
    if (parsed.positionals.length !== n) throw usage(`${parsed.command} takes ${form}.`);
}

/** The action ids a command stands for, or null if it is not an order. */
export function orderIds(parsed: Parsed): string[] | null {
    const { command, positionals: p } = parsed;
    const tile = (t: [number, number]) => t.join(",");
    switch (command) {
        case "move": {
            arity(parsed, 2, "X,Y PATH: move 6,5 uull");
            if (!/^[urdl]+$/.test(p[1])) throw usage("PATH is letters u, r, d, l.");
            return [`move:${tile(parseTile(p[0]))}:${p[1]}`];
        }
        case "attack":
        case "grenade":
        case "flashbang":
        case "smoke_grenade":
            arity(parsed, 2, `X,Y TX,TY: ${command} 3,1 0,3`);
            return [`${command}:${tile(parseTile(p[0]))}:${tile(parseTile(p[1], "target"))}`];
        case "reload":
            arity(parsed, 1, "X,Y: reload 3,1");
            return [`reload:${tile(parseTile(p[0]))}`];
        case "end":
        case "next_turn":
            arity(parsed, 0, "no arguments");
            return ["next_turn"];
        case "deploy":
        case "complete":
        case "abandon":
            arity(parsed, 0, "no arguments");
            return [command];
        case "act":
            if (p.length === 0) throw usage("act takes action ids.");
            if (p.length > MAX_BATCH) throw usage(`At most ${MAX_BATCH} ids per call.`);
            return p;
        default:
            return null;
    }
}

// === Compact output ===

/** One line per record, for a reader that wants the story rather than the structs. */
export function describeRecord(record: GameRecord): string {
    const tile = (t: number[]) => `${t[0]},${t[1]}`;
    switch (record.kind) {
        case "move": {
            return `move ${record.path.length} steps`;
        }
        case "attack":
            return `attack ${tile(record.from)} -> ${tile(record.to)}`;
        case "grenade":
        case "flashbang":
        case "smoke_grenade":
            return `${record.kind} ${tile(record.from)} -> ${tile(record.to)}`;
        case "effect_start":
            return `${record.effect} on ${record.x},${record.y} for ${record.turns} turns`;
        case "effect_end":
            return `${record.effect} on ${record.x},${record.y} ends`;
        case "reload":
            return `reload ${record.x},${record.y}`;
        case "placed":
            return `placed ${record.x},${record.y}`;
        case "damage":
            return `hit ${record.amount}`;
        case "critical_hit":
            return `crit ${record.amount}`;
        case "miss":
            return "miss";
        case "dodged":
            return "dodged";
        case "explosion":
            return `explosion ${record.x},${record.y} r${record.radius}`;
        case "kia":
            return `killed unit at ${record.x},${record.y}`;
        case "next_turn":
            return `turn ${record.turn} begins`;
    }
}

export interface Outcome {
    hits: number;
    crits: number;
    misses: number;
    dodges: number;
    damage: number;
    kills: [number, number][];
}

export function summarize(records: GameRecord[]): Outcome {
    const out: Outcome = { hits: 0, crits: 0, misses: 0, dodges: 0, damage: 0, kills: [] };
    for (const r of records) {
        if (r.kind === "damage") (out.hits++, (out.damage += r.amount));
        else if (r.kind === "critical_hit") (out.crits++, (out.damage += r.amount));
        else if (r.kind === "miss") out.misses++;
        else if (r.kind === "dodged") out.dodges++;
        else if (r.kind === "kia") out.kills.push([r.x, r.y]);
    }
    return out;
}

function receiptView(receipt: Receipt) {
    return {
        digest: receipt.digest,
        gasMist: receipt.gasMist,
        outcome: summarize(receipt.records),
        log: receipt.records.map(describeRecord),
    };
}

function unitView(unit: ObservedUnit) {
    return {
        mark: unit.mark,
        mine: unit.mine,
        at: [unit.x, unit.y],
        hp: unit.hp,
        ap: unit.ap,
        ammo: unit.ammo,
        actions: unit.actions.map((a) => (a.uses === null ? a.kind : `${a.kind}:${a.uses}`)),
        mobility: unit.mobility,
        aim: unit.aim,
        range: unit.range,
        damage: unit.damage,
        armor: unit.armor,
        dodge: unit.dodge,
        defense: unit.defense,
    };
}

function orderView(a: LegalAction) {
    const { id, kind, unit, ...rest } = a;
    void kind;
    void unit;
    return { id, ...rest };
}

/** Legal orders grouped by unit, `moves` best moves each; shots and throws are all kept. */
export function ordersByUnit(actions: LegalAction[], moves: number) {
    const byUnit: Record<string, Record<string, unknown[]>> = {};
    for (const a of actions) {
        if (!a.unit) continue;
        const group = (byUnit[a.unit.join(",")] ??= {});
        const list = (group[a.kind === "reload" ? "reload" : `${a.kind}s`] ??= []);
        if (a.kind === "move" && list.length >= moves) continue;
        list.push(orderView(a));
    }
    return byUnit;
}

// === Commands ===

/** Runs one parsed command against an agent. Throws `ActionError` for a refusal. */
export async function runCommand(agent: GhostsAgent, parsed: Parsed): Promise<unknown> {
    const { command, positionals, flags } = parsed;
    const ids = orderIds(parsed);
    if (ids) {
        const { receipt, situation } = await agent.act(ids);
        return { ok: true, ids, ...receiptView(receipt), situation };
    }

    switch (command) {
        case "whoami": {
            arity(parsed, 0, "no arguments");
            const s = await agent.status();
            return { ...s, balanceSui: Number(s.balanceMist) / 1e9 };
        }
        case "balance":
            arity(parsed, 0, "no arguments");
            return agent.balance();
        case "faucet":
            arity(parsed, 0, "no arguments");
            return agent.requestFunds();
        case "name":
            arity(parsed, 1, "one name");
            return agent.setName(positionals[0]);
        case "setup":
            arity(parsed, 0, "no arguments");
            return withAccount(agent, await agent.setup());
        case "find":
            arity(parsed, 0, "no arguments");
            return agent.findGame();
        case "cancel":
            arity(parsed, 0, "no arguments");
            return agent.cancelSearch();
        case "status":
            arity(parsed, 0, "no arguments");
            return agent.situation();
        case "host":
            arity(parsed, 0, "no arguments");
            return agent.hostLobby({ size: flags.size, invite: flags.invite });
        case "lobbies":
            arity(parsed, 0, "no arguments");
            return { lobbies: await agent.lobbies() };
        case "join-open":
            arity(parsed, 1, "an Account ID: join-open 0xHOST");
            return agent.joinOpen(positionals[0]);
        case "join":
            if (positionals.length !== 1 && positionals.length !== 2) {
                throw usage("join takes HOST:CODE, or HOST CODE.");
            }
            return positionals.length === 1
                ? agent.joinInvite(positionals[0])
                : agent.joinInvite(positionals[0], positionals[1]);
        case "kick":
            arity(parsed, 0, "no arguments");
            return agent.kickGuest();
        case "start":
            arity(parsed, 0, "no arguments");
            return agent.startFriendly();
        case "leave":
            arity(parsed, 0, "no arguments");
            return agent.leaveLobby();
        case "close":
            arity(parsed, 0, "no arguments");
            return agent.closeLobby();
        case "cleanup":
            arity(parsed, 1, "an Account ID: cleanup 0xHOST");
            return agent.cleanUpLobby(positionals[0]);
        case "wait": {
            arity(parsed, 0, "no arguments");
            const seconds = flags.timeout ?? DEFAULT_WAIT_SECONDS;
            const situation = await agent.wait({ timeoutMs: seconds * 1000 });
            return { timedOut: !situation.actionable, ...situation };
        }
        case "state": {
            arity(parsed, 0, "no arguments");
            return state(agent, flags.moves ?? 6);
        }
        case "legal": {
            arity(parsed, 0, "no arguments");
            const { actions, omitted } = await agent.legal({
                unit: flags.unit,
                kind: flags.kind,
                limit: flags.limit,
            });
            return { actions, omitted };
        }
        default:
            throw usage(`Unknown command: ${command.slice(0, 40)}.`);
    }
}

async function withAccount(agent: GhostsAgent, situation: Situation) {
    const account = await agent.backend.account();
    return { situation, account: account && { id: account.id, recruits: account.recruits } };
}

async function state(agent: GhostsAgent, moves: number) {
    const obs: Observation = await agent.observe();
    const situation = await agent.situation();
    const { actions } = await agent.legal();
    return {
        game: obs.game,
        version: obs.version,
        you: obs.you,
        opponent: obs.opponent,
        mode: obs.mode,
        turn: obs.turn,
        yourTurn: obs.yourTurn,
        status: obs.status,
        phase: situation.phase,
        turnMsLeft: obs.turnMsLeft,
        map: obs.map,
        legend: obs.legend,
        units: obs.units.map(unitView),
        // Keyed by the unit's tile "x,y"; `end`, `deploy` and `complete` show as `open`.
        orders: ordersByUnit(actions, moves),
        open: actions.filter((a) => !a.unit).map((a) => a.id),
        recent: obs.recent.map(describeRecord),
    };
}

/** The JSON a failed call prints. */
export function errorView(error: unknown) {
    if (error instanceof ActionError) {
        return { error: error.code, message: error.message, retryable: error.retryable };
    }
    return { error: "internal", message: String((error as Error)?.message ?? error) };
}

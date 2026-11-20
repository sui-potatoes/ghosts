// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Every action kind a unit can carry, in one table. The command bar, the key
 * bindings, the bar's hints, the pad's wheel, the targeting overlay, the demo
 * rules and the tests all read it, so adding an action is one entry here (and
 * its row in `packages/catalog/actions.json`, where its name, description and
 * cost live).
 *
 * A unit carries `actions: UnitAction[]` — the chain's `vector<Action>`, kind
 * and uses — and the HUD offers exactly those, in the unit's order. Whether one
 * can be taken right now is `commandState`, which asks the same questions in
 * the same order as the contract's asserts (`ghosts::ghosts::begin_unit_action`,
 * then `Unit.perform_*`), so a command the bar offers is one the chain takes.
 */

import catalog from "../../catalog/actions.json" with { type: "json" };
import type { CombatAction } from "./keys.ts";
import type { Encounter, Unit, UnitOrder } from "./game.ts";
import type { IconName } from "./ui/icons.tsx";

// === Numbers the contract keeps as constants (ghosts::map, ghosts::unit) ===

/** `MAX_RANGE_OFFSET` in `ghosts::unit`: a shot reaches this far past the weapon's range. */
export const MAX_RANGE_OFFSET = 3;
/** `GRENADE_RANGE` in `ghosts::map`: how far a grenade is thrown, in tiles. */
export const GRENADE_RANGE = 5;
/** `GRENADE_RADIUS` in `ghosts::map`: the blast's reach around the landing tile. */
export const GRENADE_RADIUS = 2;
/** `GRENADE_DAMAGE` in `ghosts::map`: before the target's armor. */
export const GRENADE_DAMAGE = 4;

// === What a unit carries ===

/**
 * One of a unit's actions, as `ghosts::action::Action` has it: the kind by its
 * catalog id (`"Move"`, `"Attack"`, …; a chain tag this client doesn't know is
 * `"#<tag>"`) and the uses left, `null` for unlimited.
 */
export interface UnitAction {
  kind: string;
  uses: number | null;
}

/** How an action picks what it acts on. */
export type Targeting =
  | { mode: "none" }
  | { mode: "tile" }
  | { mode: "unit" }
  | { mode: "area"; range: number; radius: number };

/** Why an action can't be taken right now; each names the assert that would refuse it. */
export type Refusal =
  /** `EGameOver`. */
  | "game-over"
  /** `ENotYourTurn`. */
  | "not-your-turn"
  /** `ETurnExpired`: past the turn limit only `next_turn` goes through. */
  | "turn-over"
  /** `ENoAP`. */
  | "no-ap"
  /** `EOutOfAmmo`. */
  | "no-ammo"
  /** `EFullAmmo`. */
  | "full-ammo"
  /** `ENoUsesLeft` / `action::ENoUsesLeft`. */
  | "no-uses"
  /** The demo's Extract: not on the objective. */
  | "not-on-site"
  /** The demo's Extract: done already. */
  | "secured"
  /** A kind this client can't perform: a newer contract's, or an engine-only one in a chain match. */
  | "unsupported";

/** What the bar's hint line says for a refusal. */
export const REFUSAL_TEXT: Record<Refusal, string> = {
  "game-over": "The encounter is over",
  "not-your-turn": "Not your turn",
  "turn-over": "Turn time is up. End the turn",
  "no-ap": "No action points left",
  "no-ammo": "Magazine empty. Reload",
  "full-ammo": "Magazine is full",
  "no-uses": "None left this match",
  "not-on-site": "Stand on the objective",
  secured: "Objective already secured",
  unsupported: "Not supported in this version",
};

/** The short form for tight places: the pad wheel's hub. */
export const REFUSAL_SHORT: Record<Refusal, string> = {
  "game-over": "OVER",
  "not-your-turn": "NOT YOUR TURN",
  "turn-over": "TIME UP",
  "no-ap": "NO AP",
  "no-ammo": "NO AMMO",
  "full-ammo": "MAG FULL",
  "no-uses": "NONE LEFT",
  "not-on-site": "NOT ON SITE",
  secured: "SECURED",
  unsupported: "UNSUPPORTED",
};

type CatalogEntry = (typeof catalog.actions)[number];

/** One action kind as the client knows it. */
export interface ActionSpec {
  /** The catalog id; the chain's `ActionKind` variant name. */
  id: string;
  /** The BCS tag of the `ActionKind`, null for engine-only kinds. */
  tag: number | null;
  /** `chain`: in the contract and every client. `engine`: the demo rules only. */
  status: "chain" | "engine";
  /** The engine's order: what the command runs. */
  order: UnitOrder;
  /** The combat key binding that arms or performs it. */
  key: CombatAction;
  icon: IconName;
  name: string;
  description: string;
  /** Action points it costs: a number, or all that are left. */
  ap: number | "all";
  /** Whether the unit can act again this turn afterwards. */
  endsActivation: boolean;
  targeting: Targeting;
  /**
   * The kind's own asserts after the turn's and AP's (those are common to all),
   * in the contract's order. `undefined` means available.
   */
  check?(game: Encounter, unit: Unit): Refusal | null;
}

const entry = (id: string): CatalogEntry => {
  const found = catalog.actions.find((a) => a.id === id);
  if (!found) throw new Error(`actions.json has no ${id}`);
  return found;
};

/** Name, description and cost from the catalog; the rest is how the client runs it. */
function spec(id: string, rest: Omit<ActionSpec, "id" | "tag" | "status" | "name" | "description" | "ap" | "endsActivation">): ActionSpec {
  const e = entry(id);
  return {
    id,
    tag: e.tag,
    status: e.status as "chain" | "engine",
    name: e.name,
    description: e.description,
    ap: e.ap as number | "all",
    endsActivation: !!e.endsActivation,
    ...rest,
  };
}

/** Every kind the client can perform, in catalog order. */
export const ACTIONS: readonly ActionSpec[] = [
  // `Unit.perform_move`: AP (range is the path's, checked when a tile is picked).
  spec("Move", { order: "move", key: "move", icon: "move", targeting: { mode: "tile" } }),
  // `Unit.perform_attack`: AP, then ammo; range and sight when a target is picked.
  spec("Attack", {
    order: "fire",
    key: "fire",
    icon: "cross",
    targeting: { mode: "unit" },
    check: (_, u) => (u.ammo > 0 ? null : "no-ammo"),
  }),
  // `Unit.perform_reload`: AP, then a magazine that isn't full.
  spec("Reload", {
    order: "reload",
    key: "reload",
    icon: "reload",
    targeting: { mode: "none" },
    check: (_, u) => (u.ammo < u.clip ? null : "full-ammo"),
  }),
  // `Unit.perform_grenade`: AP, then a use left; range, wall and line of throw at the tile.
  spec("Grenade", {
    order: "grenade",
    key: "grenade",
    icon: "grenade",
    targeting: { mode: "area", range: GRENADE_RANGE, radius: GRENADE_RADIUS },
  }),
  // `Unit.perform_flashbang`: the frag's throw checks (`Map.thrower`, `Unit.throw`); dazes the burst.
  spec("Flashbang", {
    order: "flashbang",
    key: "flashbang",
    icon: "flash",
    targeting: { mode: "area", range: GRENADE_RANGE, radius: GRENADE_RADIUS },
  }),
  // `Unit.perform_smoke_grenade`: the same throw; smokes the burst.
  spec("SmokeGrenade", {
    order: "smoke-grenade",
    key: "smoke-grenade",
    icon: "smoke",
    targeting: { mode: "area", range: GRENADE_RANGE, radius: GRENADE_RADIUS },
  }),
  // The demo rules' own orders: never in a chain match.
  spec("Overwatch", {
    order: "overwatch",
    key: "overwatch",
    icon: "eye",
    targeting: { mode: "none" },
    check: (_, u) => (u.ammo > 0 ? null : "no-ammo"),
  }),
  spec("Hunker", { order: "hunker", key: "hunker", icon: "shield", targeting: { mode: "none" } }),
  spec("Secure", {
    order: "secure",
    key: "secure",
    icon: "extract",
    targeting: { mode: "none" },
    check: (game, u) =>
      game.secured ? "secured" : u.pos[0] !== game.relay[0] || u.pos[1] !== game.relay[1] ? "not-on-site" : null,
  }),
];

const BY_ID = new Map(ACTIONS.map((a) => [a.id, a]));
const BY_ORDER = new Map(ACTIONS.map((a) => [a.order, a]));

/** The spec for a catalog id, or undefined for a kind this client can't perform. */
export const actionSpec = (id: string) => BY_ID.get(id);

/** The spec behind an engine order. */
export const specOf = (order: UnitOrder) => BY_ORDER.get(order)!;

/** The orders that throw: the frag grenade, the flashbang, the smoke grenade. All share range and radius. */
export type ThrowOrder = "grenade" | "flashbang" | "smoke-grenade";
export const THROW_ORDERS: readonly ThrowOrder[] = ["grenade", "flashbang", "smoke-grenade"];
export const isThrowOrder = (order: string): order is ThrowOrder => (THROW_ORDERS as readonly string[]).includes(order);

/** The effect each non-damaging grenade leaves on every unit in its burst. */
export const THROW_EFFECT: Partial<Record<ThrowOrder, string>> = { flashbang: "Daze", "smoke-grenade": "Smoke" };

/** The catalog id for a chain tag; `"#<tag>"` for one this client doesn't know. */
export function kindOfTag(tag: number): string {
  return catalog.actions.find((a) => a.tag === tag)?.id ?? `#${tag}`;
}

/** The catalog's entry for a kind: by id, or by tag for `"#<tag>"`. */
function catalogEntry(kind: string): CatalogEntry | undefined {
  const tag = /^#(\d+)$/.exec(kind);
  return tag ? catalog.actions.find((a) => a.tag === Number(tag[1])) : catalog.actions.find((a) => a.id === kind);
}

/** A kind's display name: the catalog's, even for a kind the client can't perform. */
export function actionName(kind: string): string {
  return catalogEntry(kind)?.name ?? `Action ${kind.replace(/^#/, "")}`;
}

/** A kind's catalog description, empty when it has none. */
export function actionDescription(kind: string): string {
  return catalogEntry(kind)?.description ?? "";
}

// === A unit's actions, as the contract reads them ===

/** `Unit.has_action`: any action of the kind, spent or not. */
export const hasKind = (u: Pick<Unit, "actions">, kind: string) => u.actions.some((a) => a.kind === kind);

/**
 * Uses left of a kind, over all its entries: `null` when one of them is
 * unlimited, 0 when the unit has none (or they are spent).
 */
export function usesLeft(u: Pick<Unit, "actions">, kind: string): number | null {
  let left = 0;
  for (const a of u.actions) {
    if (a.kind !== kind) continue;
    if (a.uses === null) return null;
    left += a.uses;
  }
  return left;
}

/** Whether a kind is limited at all: every entry of it carries a count. */
export const isLimited = (u: Pick<Unit, "actions">, kind: string) =>
  hasKind(u, kind) && u.actions.every((a) => a.kind !== kind || a.uses !== null);

/**
 * `Unit.spend_use`: one use off the first action of the kind that has one left;
 * an unlimited one is left alone. False when every entry is spent (`ENoUsesLeft`).
 */
export function spendUse(u: Pick<Unit, "actions">, kind: string): boolean {
  const a = u.actions.find((a) => a.kind === kind && (a.uses === null || a.uses > 0));
  if (!a) return false;
  if (a.uses !== null) a.uses--;
  return true;
}

/** The kinds a unit carries, each once, in the order it first carries them. */
export function unitKinds(u: Pick<Unit, "actions">): string[] {
  return [...new Set(u.actions.map((a) => a.kind))];
}

/** One command on the bar: a kind the unit carries, and whether it can be taken now. */
export interface CommandState {
  kind: string;
  /** Undefined for a kind this client can't perform. */
  spec?: ActionSpec;
  name: string;
  /** Uses left when the kind is limited, null when not. */
  uses: number | null;
  refusal: Refusal | null;
}

/** Whether `kind` can be taken by `u` now; `now` (ms) is checked against the turn's deadline. */
export function refusalOf(game: Encounter, u: Unit, kind: string, now = Date.now()): Refusal | null {
  const spec = BY_ID.get(kind);
  if (!spec || (spec.status !== "chain" && game.scenario.versus)) return "unsupported";
  // `begin_turn_action`: the game, the side, the clock.
  if (game.result) return "game-over";
  if (u.enemy !== (game.phase === "enemy")) return "not-your-turn";
  if (game.turnDeadline !== undefined && now > game.turnDeadline) return "turn-over";
  // `perform_*`: every action costs AP first.
  if (u.ap <= 0) return "no-ap";
  if (isLimited(u, kind) && !usesLeft(u, kind)) return "no-uses";
  return spec.check?.(game, u) ?? null;
}

/** The unit's commands, one per kind it carries, in its own order. */
export function commandsOf(game: Encounter, u: Unit, now = Date.now()): CommandState[] {
  return unitKinds(u).map((kind) => ({
    kind,
    spec: BY_ID.get(kind),
    name: actionName(kind),
    uses: isLimited(u, kind) ? usesLeft(u, kind) : null,
    refusal: refusalOf(game, u, kind, now),
  }));
}

/** "1 AP", "ALL AP": a command's cost as the bar prints it. */
export const costLabel = (spec: ActionSpec | undefined) =>
  !spec ? "" : spec.ap === "all" ? "ALL AP" : `${spec.ap} AP`;

/**
 * The actions a unit has from its loadout, as `Unit::from_recruit` builds them:
 * `Move`, then `Attack` and `Reload` with a weapon, then each utility's in slot
 * order. The demo rules add their own orders after: Overwatch with a weapon,
 * Hunker, and Extract where the scenario has an objective to secure.
 */
export function loadoutActions({
  armed,
  utilities,
  demo,
}: {
  armed: boolean;
  /** What each carried utility grants, in slot order. */
  utilities: readonly UnitAction[][];
  /** The demo rules' extras, and whether the scenario has an objective to extract. */
  demo?: { extract: boolean };
}): UnitAction[] {
  const actions: UnitAction[] = [{ kind: "Move", uses: null }];
  if (armed) actions.push({ kind: "Attack", uses: null }, { kind: "Reload", uses: null });
  for (const granted of utilities) actions.push(...granted.map((a) => ({ ...a })));
  if (demo) {
    if (armed) actions.push({ kind: "Overwatch", uses: null });
    actions.push({ kind: "Hunker", uses: null });
    if (demo.extract) actions.push({ kind: "Secure", uses: null });
  }
  return actions;
}

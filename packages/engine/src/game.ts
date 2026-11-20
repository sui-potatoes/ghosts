// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { ChainGround } from "./chain-ground.ts";
import { CELL, TacticalMap, type Cell } from "./map.ts";
import { describe, type Command, type GameEvent } from "./events.ts";
import { blackRain, type Scenario } from "./scenario.ts";
import {
  GRENADE_DAMAGE,
  GRENADE_RADIUS,
  GRENADE_RANGE,
  MAX_RANGE_OFFSET,
  THROW_EFFECT,
  hasKind,
  loadoutActions,
  spendUse,
  specOf,
  usesLeft,
  type UnitAction,
} from "./action-registry.ts";
import { endEffect, freshEffect, setEffect, tickEffects, unitCombat, type UnitEffect } from "./status-effects.ts";
import type { WeaponMod } from "./intel.ts";
// Local presentation simulation. Rules reference ghosts::{unit,map,stats}; no chain imports.
export type { Cell };
export type Weapon = "rifle" | "sniper" | "pistol";
export const weapons = {
  rifle: { label: "MX–4 ASSAULT RIFLE", damage: 6, range: 8, clip: 3, aim: 78 },
  sniper: {
    label: "SRS–9 PRECISION RIFLE",
    damage: 9,
    range: 12,
    clip: 3,
    aim: 88,
  },
  pistol: { label: "K–12 SIDEARM", damage: 4, range: 5, clip: 6, aim: 82 },
};
/** A unit's weapon as the HUD names it: the recruit's own (a trailing " +" with mods fitted), else the scenario's. */
export const weaponName = (u: Pick<Unit, "weapon" | "gear">) =>
  !u.gear
    ? weapons[u.weapon].label
    : !u.gear.weapon
      ? "Unarmed"
      : u.gear.weapon.mods.length
        ? `${u.gear.weapon.name} +`
        : u.gear.weapon.name;
export type Role = "ASSAULT" | "RECON" | "HEAVY" | "SPECIALIST";
/** The orders the HUD offers a unit; chain `Attack` is `fire`. */
export type UnitOrder =
  | "move"
  | "fire"
  | "grenade"
  | "flashbang"
  | "smoke-grenade"
  | "reload"
  | "overwatch"
  | "hunker"
  | "secure";
/** What an ally deployed from a recruit carries, as the readouts name it (a scenario's units carry none). */
export interface UnitGear {
  /** The primary weapon by name, with its fitted mods; null when unarmed. */
  weapon: { name: string; mods: WeaponMod[] } | null;
  armor: string | null;
  /** Rank by name and step (0 = the lowest), when the recruit has one. */
  rank?: { name: string; index: number };
}
export interface Unit {
  id: string;
  name: string;
  full: string;
  role: Role;
  enemy: boolean;
  pos: Cell;
  hp: number;
  maxHp: number;
  ap: number;
  ammo: number;
  clip: number;
  armor: number;
  aim: number;
  range: number;
  mobility: number;
  damage: number;
  /** A hit deals `damage` plus or minus up to this much (`spread`). */
  spread: number;
  /** Percent chance a hit deals one more (`plus_one`). */
  plusOne: number;
  /** Percent chance a hit is critical, adding half the damage (`crit_chance`). */
  critChance: number;
  /** Percent chance a hit is dodged (`dodge`). */
  dodge: number;
  /** Points off every hit chance against the unit, with cover (`defense`). */
  defense: number;
  /** The recruit's gear, for the readouts; absent for scenario units. */
  gear?: UnitGear;
  hunkered: boolean;
  overwatch: boolean;
  weapon: Weapon;
  magazines: Record<Weapon, number>;
  color: string;
  /**
   * What this unit may do, in its own order, with the uses left: the chain's
   * `Unit.actions`, or the demo's from the loadout (`loadoutActions`).
   */
  actions: UnitAction[];
  /** Status effects on the unit, in the order they landed (`Unit.effects`, status-effects.ts). */
  effects: UnitEffect[];
}
/** Whether `u` carries `order` at all (`Unit.has_action`): AP, ammo and uses aside. */
export const allows = (u: Pick<Unit, "actions">, order: UnitOrder) => hasKind(u, specOf(order).id);
export const key = (p: Cell) => p.join(",");
export const distance = (a: Cell, b: Cell) =>
  Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
/**
 * Damage one hit deals: the attacker's equipped weapon against the target's
 * armor. The rules roll with it; the aim HUD previews it on the health bar.
 */
export function shotDamage(a: Unit, b: Unit, crit = false): number {
  return Math.max(1, a.damage + (crit ? Math.floor(a.damage / 2) : 0) - b.armor);
}
/** Units as `scenario` deploys them, with stats from role and weapon. */
export function initialUnits(scenario: Scenario = blackRain): Unit[] {
  return scenario.units.map(({ id, name, full, role, pos, color, enemy = false }) => {
    const weapon: Weapon = role === "RECON" ? "sniper" : "rifle";
    const magazines = { rifle: 3, sniper: 3, pistol: 6 };
    return {
      id,
      full,
      role,
      enemy,
      pos: [...pos],
      hp: enemy ? 9 : 12,
      maxHp: enemy ? 9 : 12,
      ap: 2,
      armor: role === "HEAVY" ? 2 : 1,
      mobility: role === "HEAVY" ? 5 : 7,
      // Armed, no utilities until the host's loadout says otherwise (`applyLoadouts`).
      actions: loadoutActions({
        armed: true,
        utilities: [],
        demo: enemy ? undefined : { extract: !scenario.versus && !scenario.noObjective },
      }),
      effects: [],
      hunkered: false,
      overwatch: false,
      weapon,
      magazines,
      color,
      ...weapons[weapon],
      // no spread, no dodge: a fixed hit with the old one-in-ten crit, until a loadout says otherwise
      spread: 0,
      plusOne: 0,
      critChance: 10,
      dodge: 0,
      defense: 0,
      name,
      ammo: magazines[weapon],
    };
  });
}
/**
 * What whoever decides an encounter says about its ground and its shots, when
 * that isn't the bundled rules: the odds on screen and the paths offered are
 * then the ones that will really apply.
 */
export interface GameAuthority {
  /** The chance `a` hits `b`, in percent; 0 when the shot can't be taken. */
  chance(a: Unit, b: Unit): number;
  /** The cover `at` has against a shot from `from`. */
  cover(from: Unit, at: Unit): number;
  clearShot(from: Cell, to: Cell): boolean;
  clearThrow(from: Cell, to: Cell): boolean;
  terrain(cell: Cell): "open" | "cover" | "blocked";
  /** Whether a step between two neighbouring open cells is allowed (an edge may block it); all are when absent. */
  step?(from: Cell, to: Cell): boolean;
  /** The cover `at` has with no attacker in mind, for the HUD and the poses; the scene's geometry when absent. */
  shelter?(at: Cell): number;
  /** A grenade went off at `at`: whatever the authority keeps of the ground follows. */
  blast?(at: Cell): void;
}

/** The demo's flat hunker bonus, on top of whatever cover the ground gives. */
const HUNKER_BONUS = 25;

/**
 * The bundled rules on a Move tile grid: moving, cover, sight and throws as
 * `ghosts::map` has them (`chain-ground.ts`), the odds as `Unit.perform_attack`
 * works them out. Hunkering, a demo-only order, keeps its flat bonus.
 */
export function groundAuthority(ground: ChainGround): GameAuthority {
  const cover = (from: Unit, at: Unit) => ground.cover(from.pos, at.pos) + (at.hunkered ? HUNKER_BONUS : 0);
  return {
    terrain: (cell) => ground.terrain(cell),
    step: (from, to) => ground.step(from, to),
    shelter: (at) => ground.shelter(at),
    clearShot: (from, to) => ground.clearShot(from, to),
    clearThrow: (from, to) => ground.clearThrow(from, to),
    blast: (at) => ground.blast(at),
    cover,
    // `Unit.perform_attack`: the shooter's effective aim, the target's cover plus effective defense.
    chance: (a, b) =>
      ground.clearShot(a.pos, b.pos)
        ? ChainGround.hitChance(unitCombat(a).aim, a.range, distance(a.pos, b.pos), cover(a, b) + unitCombat(b).defense)
        : 0,
  };
}
export class Encounter {
  readonly scenario: Scenario;
  readonly map: TacticalMap;
  /** Whoever decides this encounter, when it isn't the bundled rules. */
  authority?: GameAuthority;
  /**
   * When the turn in play runs out (epoch ms), for a match with a turn limit:
   * past it the contract takes only `next_turn` (`ETurnExpired`). The host's
   * driver keeps it; the bundled rules have no clock.
   */
  turnDeadline?: number;
  units: Unit[];
  // Encounter-local credit, shared by direct fire, overwatch and grenades.
  kills: Record<string, number> = {};
  turn = 1;
  phase: "player" | "enemy" = "player";
  secured = false;
  log: string[];
  /** Every event so far, oldest first. */
  readonly events: GameEvent[] = [];
  seed = 731;
  constructor(scenario: Scenario = blackRain) {
    this.scenario = scenario;
    this.map = new TacticalMap(scenario.map);
    if (scenario.ground) this.authority = groundAuthority(new ChainGround(scenario.ground));
    this.units = initialUnits(scenario);
    this.log = [scenario.lines.opening];
  }
  get relay(): Cell {
    return this.scenario.relay;
  }
  /** Hostiles the scenario deployed, living or not. */
  get hostileCount() {
    return this.units.filter((u) => u.enemy).length;
  }
  get allies() {
    return this.units.filter((u) => !u.enemy && u.hp > 0);
  }
  get enemies() {
    return this.units.filter((u) => u.enemy && u.hp > 0);
  }
  get result() {
    if (this.scenario.versus)
      return !this.allies.length ? "defeat" : !this.enemies.length ? "victory" : null;
    return !this.allies.length
      ? "defeat"
      : !this.enemies.length && (this.secured || this.scenario.noObjective)
        ? "victory"
        : null;
  }
  random() {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
  private creditKill(attacker: Unit, target: Unit) {
    if (!attacker.enemy && target.enemy)
      this.kills[attacker.id] = (this.kills[attacker.id] ?? 0) + 1;
  }
  add(message: string) {
    this.log.unshift(message);
    this.log = this.log.slice(0, 30);
  }
  unit(id: string): Unit | undefined {
    return this.units.find((u) => u.id === id);
  }
  /** Apply an event, record it and write its feed line. */
  private emit(event: GameEvent) {
    this.applyEvent(event);
    this.events.push(event);
    const line =
      event.type === "secure"
        ? this.scenario.lines.secured
        : describe(event, (id) => this.unit(id)?.name ?? id);
    if (line) this.add(line);
  }
  /**
   * Take in an event decided elsewhere — a replay, a server, the chain — as
   * `emit` would a local one: applied, journaled, on the feed. The caller
   * vouches for the event; nothing is validated or rolled again.
   */
  ingest(event: GameEvent) {
    this.emit(event);
  }
  /**
   * State from one event, deterministically: the reducer behind both local
   * play and `ingest`. Every decision — legality, paths, dice — has already
   * been made; this only carries the outcome into the units.
   */
  private applyEvent(event: GameEvent) {
    if (event.type === "shot" || event.type === "grenade")
      this.map.applyPropDamage(event.environment ?? []);
    switch (event.type) {
      case "move": {
        const u = this.unit(event.unit)!;
        u.pos = [...event.path.at(-1)!];
        u.ap--;
        u.hunkered = false;
        u.overwatch = false;
        return;
      }
      case "shot": {
        const a = this.unit(event.unit)!,
          b = this.unit(event.target)!;
        // `Unit.perform_attack` depletes AP, whatever the weapon.
        a.ap = 0;
        a.hunkered = false;
        a.overwatch = false;
        a.ammo--;
        a.magazines[a.weapon] = a.ammo;
        b.hp = Math.max(0, b.hp - event.damage);
        // `UnitKIA` ends every effect on the unit; no `EffectEnd` is written.
        if (b.hp <= 0) b.effects = [];
        if (event.killed) this.creditKill(a, b);
        return;
      }
      case "reload": {
        const u = this.unit(event.unit)!;
        u.ammo = u.clip;
        u.magazines[u.weapon] = u.ammo;
        u.ap--;
        return;
      }
      case "grenade": {
        const u = this.unit(event.unit)!;
        this.authority?.blast?.(event.at);
        u.ap--;
        spendUse(u, "Grenade");
        for (const { unit, damage, killed } of event.casualties) {
          const target = this.unit(unit)!;
          target.hp -= damage;
          if (target.hp <= 0) target.effects = [];
          if (killed) this.creditKill(u, target);
        }
        return;
      }
      case "flashbang":
      case "smoke-grenade": {
        // `Unit.throw`: one AP and the use; the burst lands as `effect-start`s.
        const u = this.unit(event.unit)!;
        u.ap--;
        spendUse(u, specOf(event.type).id);
        return;
      }
      case "effect-start":
        setEffect(this.unit(event.unit)!.effects, event.effect);
        return;
      case "effect-end": {
        const u = this.unit(event.unit)!;
        u.effects = endEffect(u.effects, event.kind);
        return;
      }
      case "hunker": {
        const u = this.unit(event.unit)!;
        u.ap = 0;
        u.hunkered = true;
        u.overwatch = false;
        return;
      }
      case "overwatch": {
        const u = this.unit(event.unit)!;
        u.ap = 0;
        u.overwatch = true;
        u.hunkered = false;
        return;
      }
      case "switch-weapon": {
        const u = this.unit(event.unit)!;
        u.magazines[u.weapon] = u.ammo;
        u.weapon = event.weapon;
        const stats = weapons[event.weapon];
        u.damage = stats.damage;
        u.range = stats.range;
        u.clip = stats.clip;
        u.aim = stats.aim;
        u.ammo = u.magazines[event.weapon];
        return;
      }
      case "watch-spent": {
        const u = this.unit(event.unit)!;
        u.overwatch = false;
        u.ap = 0;
        return;
      }
      case "secure":
        this.unit(event.unit)!.ap--;
        this.secured = true;
        return;
      // Both are a `next_turn`: one turn off every effect on every living unit.
      case "hostile-phase":
        this.phase = "enemy";
        for (const u of this.enemies) u.ap = 2;
        this.tick();
        return;
      case "turn":
        this.phase = "player";
        this.turn = event.turn;
        this.tick();
        for (const u of this.allies) {
          u.ap = 2;
          u.overwatch = false;
          u.hunkered = false;
        }
        return;
    }
  }
  /** `Map.next_turn`'s walk: one turn off every effect on every unit still standing. */
  private tick() {
    for (const u of this.units) if (u.hp > 0) tickEffects(u.effects);
  }
  /**
   * The living units in `Map.units` order (row-major by tile: row, then
   * column), the order the contract writes `EffectStart` and `EffectEnd` in.
   * A tile's row is its scene `z`, its column its `x`.
   */
  unitsInMapOrder(): Unit[] {
    return this.units.filter((u) => u.hp > 0).sort((a, b) => a.pos[1] - b.pos[1] || a.pos[0] - b.pos[0]);
  }
  /** After a turn end: an `effect-end` for every effect that ran out, unit by unit, in list order. */
  private expire() {
    for (const u of this.unitsInMapOrder())
      for (const e of u.effects.filter((e) => e.turns <= 0)) this.emit({ type: "effect-end", unit: u.id, kind: e.kind });
  }
  /** Run `fn` and return the events it emitted. */
  private record(fn: () => unknown): GameEvent[] {
    const from = this.events.length;
    fn();
    return this.events.slice(from);
  }
  /** Carry out one order. Returns what happened; empty when the order is refused. */
  apply(command: Command): GameEvent[] {
    const u = this.unit(command.unit);
    if (!u) return [];
    return this.record(() => {
      switch (command.type) {
        case "move":
          return this.move(u, command.to);
        case "fire": {
          const target = this.unit(command.target);
          return target && this.attack(u, target);
        }
        case "grenade":
          return this.throwGrenade(u, command.at);
        case "flashbang":
        case "smoke-grenade":
          return this.throwEffect(u, command.at, command.type);
        case "reload":
          return this.reload(u);
        case "hunker":
          return this.hunker(u);
        case "overwatch":
          return this.watch(u);
        case "secure":
          return this.secure(u);
        case "switch-weapon":
          return this.switchWeapon(u, command.weapon);
      }
    });
  }
  /** Whether a shot from one cell to another has a clear line. */
  shotBlocked(from: Cell, to: Cell) {
    return this.authority ? !this.authority.clearShot(from, to) : this.map.coverPeek(from, to).blocked;
  }
  /** Whether a throw from one cell can land on another. */
  throwBlocked(from: Cell, to: Cell) {
    return this.authority ? !this.authority.clearThrow(from, to) : !this.map.clearThrow(from, to);
  }
  private groundOpen(p: Cell) {
    return this.authority ? this.authority.terrain(p) === "open" : this.map.open(p);
  }
  private groundCover(p: Cell) {
    return this.authority ? this.authority.terrain(p) === "cover" : this.map.isCover(p);
  }
  /** Whether the edge between two neighbouring cells lets a unit through. */
  private passable(from: Cell, to: Cell) {
    return this.authority?.step ? this.authority.step(from, to) : true;
  }
  walkable(p: Cell, unit?: Unit) {
    return (
      this.groundOpen(p) &&
      !this.units.some((u) => u !== unit && u.hp > 0 && key(u.pos) === key(p))
    );
  }
  paths(unit: Unit) {
    const found = new Map<string, Cell[]>();
    const queue: Cell[][] = [[unit.pos]];
    found.set(key(unit.pos), [unit.pos]);
    for (let i = 0; i < queue.length; i++) {
      const path = queue[i];
      if (path.length > unit.mobility) continue;
      const [x, z] = path[path.length - 1];
      for (const p of [
        [x + 1, z],
        [x - 1, z],
        [x, z + 1],
        [x, z - 1],
      ] as Cell[]) {
        if (!found.has(key(p)) && this.walkable(p, unit) && this.passable([x, z], p)) {
          const next = [...path, p];
          found.set(key(p), next);
          queue.push(next);
        } else if (this.groundCover(p)) {
          const landing: Cell = [p[0] + p[0] - x, p[1] + p[1] - z];
          if (
            path.length + 1 <= unit.mobility &&
            !found.has(key(landing)) &&
            this.walkable(landing, unit)
          ) {
            const next = [...path, p, landing];
            found.set(key(landing), next);
            queue.push(next);
          }
        }
      }
    }
    return found;
  }
  /** See `allows`. */
  allows(u: Unit, order: UnitOrder) {
    return allows(u, order);
  }
  canAct(u: Unit) {
    return (
      u.hp > 0 &&
      u.ap > 0 &&
      !this.result &&
      u.enemy === (this.phase === "enemy")
    );
  }
  move(u: Unit, p: Cell) {
    if (!this.canAct(u) || !allows(u, "move")) return null;
    const path = this.paths(u).get(key(p));
    if (!path || path.length < 2) return null;
    this.emit({
      type: "move",
      unit: u.id,
      path,
      vault: path.some((c) => this.groundCover(c)),
      cover: this.coverValue(p, false) > 0,
    });
    return path;
  }
  /** Whether a unit arriving on `p` would take cover there. */
  coverAt(p: Cell) {
    return this.coverValue(p, false) > 0;
  }
  /** Defense against `attacker` (or against anyone, without one): walls, barriers, hunkering. */
  cover(u: Unit, attacker?: Unit) {
    if (attacker && this.authority) return this.authority.cover(attacker, u);
    return this.coverValue(u.pos, u.hunkered, attacker);
  }
  private coverValue(pos: Cell, hunkered: boolean, attacker?: Unit) {
    if (this.authority?.shelter) return this.authority.shelter(pos) + (hunkered ? HUNKER_BONUS : 0);
    const map = this.map;
    const behindWall = attacker
      ? !map.clearBuildingShot(
          [attacker.pos[0] * CELL, attacker.pos[1] * CELL],
          [pos[0] * CELL, pos[1] * CELL],
        )
      : map.physicalCover(pos) === "high";
    if (map.highCoverAt(pos) && behindWall) return hunkered ? 60 : 40;
    const barrier = map.covers.some(
      (c) =>
        distance(c, pos) === 1 &&
        (!attacker || distance(c, attacker.pos) < distance(pos, attacker.pos)),
    );
    return barrier ? (hunkered ? 50 : 25) : hunkered ? 20 : 0;
  }
  /** The odds `a` hits `b`, in percent: effective aim against cover and effective defense (status effects counted). */
  chance(a: Unit, b: Unit) {
    if (this.authority) return this.authority.chance(a, b);
    const d = distance(a.pos, b.pos);
    if (d > a.range + MAX_RANGE_OFFSET || this.map.coverPeek(a.pos, b.pos).blocked) return 0;
    const aim = unitCombat(a).aim;
    return Math.max(
      0,
      Math.min(
        100,
        aim + (d < a.range ? (a.range - d) * 5 : -(d - a.range) * 10),
      ) - Math.min(100, this.cover(b, a) + unitCombat(b).defense),
    );
  }
  /** Whether `a` has a line and the range to shoot `b` at all, AP aside. */
  private canShoot(a: Unit, b: Unit) {
    return (
      a.ammo > 0 &&
      b.hp > 0 &&
      a.enemy !== b.enemy &&
      distance(a.pos, b.pos) <= a.range + MAX_RANGE_OFFSET &&
      !this.shotBlocked(a.pos, b.pos)
    );
  }
  attack(a: Unit, b: Unit) {
    if (!this.canAct(a) || !allows(a, "fire") || !this.canShoot(a, b)) return null;
    return this.shoot(a, b, false);
  }
  /**
   * Overwatch: an ally who held fire takes one shot at a hostile moving in
   * reach, out of turn. The watch is spent even when the line is blocked.
   */
  reactionFire(ally: Unit, enemy: Unit) {
    if (!ally.overwatch || ally.hp <= 0 || this.phase !== "enemy") return null;
    if (!this.canShoot(ally, enemy)) {
      this.emit({ type: "watch-spent", unit: ally.id });
      return null;
    }
    return this.shoot(ally, enemy, true);
  }
  private shoot(a: Unit, b: Unit, reaction: boolean) {
    const chance = this.chance(a, b);
    let hit = this.random() * 100 < chance;
    let crit = hit && this.random() < a.critChance / 100;
    // `Unit.perform_attack`: the damage stat varies by up to `spread` either way (never below 0),
    // maybe one more, and a critical adds half the stat; `apply_damage` then takes the armor off (not below 1)
    let raw = a.damage;
    if (hit && a.spread > 0) {
      const up = this.random() < 0.5;
      const offset = Math.floor(this.random() * ((up ? a.spread : Math.min(a.spread, a.damage)) + 1));
      raw += up ? offset : -offset;
    }
    if (hit && a.plusOne > 0 && this.random() * 100 < a.plusOne) raw++;
    if (crit) raw += Math.floor(a.damage / 2);
    // a shot can be dodged, and a dodge shows as a miss (`Dodged` in a chain match)
    if (hit && b.dodge > 0 && this.random() * 100 < b.dodge) hit = crit = false;
    const damage = hit ? Math.max(1, raw - b.armor) : 0;
    const killed = hit && b.hp - damage <= 0;
    const cover = !hit && this.map.props.find((p) =>
      this.map.health(p.id) > 0 && (p.covers ?? (p.cover ? [p.cover] : [])).some(cell =>
        this.map.isCover(cell) && distance(cell, b.pos) === 1 && distance(cell, a.pos) < distance(b.pos, a.pos)));
    const propDamage = a.weapon === "sniper" ? 45 : 28;
    const environment = hit ? [] : cover ? this.map.damageProp(cover.id, propDamage) :
      this.map.strayShotProps(a.pos, b.pos, propDamage);
    this.emit({ type: "shot", unit: a.id, target: b.id, hit, crit, damage, killed, reaction, environment });
    return { hit, damage, crit };
  }
  reload(u: Unit) {
    if (!this.canAct(u) || !allows(u, "reload") || u.ammo === u.clip) return false;
    this.emit({ type: "reload", unit: u.id });
    return true;
  }
  throwGrenade(u: Unit, p: Cell) {
    if (
      !this.canAct(u) ||
      !allows(u, "grenade") ||
      usesLeft(u, "Grenade") === 0 ||
      distance(u.pos, p) > GRENADE_RANGE ||
      this.throwBlocked(u.pos, p)
    )
      return false;
    // `Map.explode`: armor takes off the damage, never below 1; no dodge.
    const casualties = this.units
      .filter((t) => t.hp > 0 && distance(t.pos, p) <= GRENADE_RADIUS)
      .map((t) => {
        const damage = Math.min(t.hp, Math.max(1, GRENADE_DAMAGE - t.armor));
        return { unit: t.id, damage, killed: t.hp - damage === 0 };
      });
    const environment = this.map.blastProps(p);
    this.emit({ type: "grenade", unit: u.id, at: [...p], casualties, environment });
    return true;
  }
  /**
   * `Map.perform_flashbang` / `Map.perform_smoke_grenade`: the frag's throw
   * checks (range, wall, line of throw), then the effect on every living unit
   * within the burst, either side, the thrower too. No damage, cover stays.
   */
  throwEffect(u: Unit, p: Cell, order: "flashbang" | "smoke-grenade") {
    const kind = specOf(order).id;
    if (
      !this.canAct(u) ||
      !allows(u, order) ||
      usesLeft(u, kind) === 0 ||
      distance(u.pos, p) > GRENADE_RANGE ||
      this.throwBlocked(u.pos, p)
    )
      return false;
    this.emit({ type: order, unit: u.id, at: [...p] });
    const fresh = freshEffect(THROW_EFFECT[order]!);
    for (const t of this.unitsInMapOrder()) {
      if (distance(t.pos, p) > GRENADE_RADIUS) continue;
      // `refresh`: a kind already on the unit keeps the larger timer.
      const had = t.effects.find((e) => e.kind === fresh.kind);
      this.emit({ type: "effect-start", unit: t.id, effect: { kind: fresh.kind, turns: Math.max(fresh.turns, had?.turns ?? 0) } });
    }
    return true;
  }
  secure(u: Unit) {
    if (!this.canAct(u) || !allows(u, "secure") || this.secured || distance(u.pos, this.relay) > 0)
      return false;
    this.emit({ type: "secure", unit: u.id });
    return true;
  }
  switchWeapon(u: Unit, w: Weapon) {
    if (!this.canAct(u) || u.weapon === w) return false;
    this.emit({ type: "switch-weapon", unit: u.id, weapon: w });
    return true;
  }
  hunker(u: Unit) {
    if (!this.canAct(u) || !allows(u, "hunker")) return false;
    this.emit({ type: "hunker", unit: u.id });
    return true;
  }
  watch(u: Unit) {
    if (!this.canAct(u) || !allows(u, "overwatch") || u.ammo < 1) return false;
    this.emit({ type: "overwatch", unit: u.id });
    return true;
  }
  /** The player's `next_turn`: the hostile phase, then the effects that ran out. Returns the events. */
  beginEnemy(): GameEvent[] {
    return this.record(() => {
      this.emit({ type: "hostile-phase" });
      this.expire();
    });
  }
  /** The hostiles' `next_turn`: the player's turn, then the effects that ran out. Returns the events. */
  nextTurn(): GameEvent[] {
    return this.record(() => {
      this.emit({ type: "turn", turn: this.turn + 1 });
      this.expire();
    });
  }
  /** `reactionFire` as events, for the hostile phase. */
  react(ally: Unit, enemy: Unit): GameEvent[] {
    return this.record(() => this.reactionFire(ally, enemy));
  }
}

/** The encounter a journal describes, rebuilt without re-running any command. */
export function replayEncounter(scenario: Scenario, events: Iterable<GameEvent>): Encounter {
  const game = new Encounter(scenario);
  for (const event of events) game.ingest(event);
  return game;
}

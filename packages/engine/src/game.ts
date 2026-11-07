// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { CELL, TacticalMap, type Cell } from "./map.ts";
import { describe, type Command, type GameEvent } from "./events.ts";
import { blackRain, type Scenario } from "./scenario.ts";
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
export type Role = "ASSAULT" | "RECON" | "HEAVY" | "SPECIALIST";
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
  grenade: boolean;
  hunkered: boolean;
  overwatch: boolean;
  weapon: Weapon;
  magazines: Record<Weapon, number>;
  color: string;
}
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
      grenade: false,
      hunkered: false,
      overwatch: false,
      weapon,
      magazines,
      color,
      ...weapons[weapon],
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
  /** The weapons lying on the field, for a unit standing there to take up. */
  dropped(): { cell: Cell; name: string }[];
}
export class Encounter {
  readonly scenario: Scenario;
  readonly map: TacticalMap;
  /** Whoever decides this encounter, when it isn't the bundled rules. */
  authority?: GameAuthority;
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
      : !this.enemies.length && this.secured
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
        a.ap = event.reaction || a.weapon !== "pistol" ? 0 : a.ap - 1;
        a.hunkered = false;
        a.overwatch = false;
        a.ammo--;
        a.magazines[a.weapon] = a.ammo;
        b.hp = Math.max(0, b.hp - event.damage);
        if (event.killed) this.creditKill(a, b);
        return;
      }
      case "reload":
      case "pick-up": {
        const u = this.unit(event.unit)!;
        u.ammo = u.clip;
        u.magazines[u.weapon] = u.ammo;
        u.ap--;
        return;
      }
      case "grenade": {
        const u = this.unit(event.unit)!;
        u.ap--;
        u.grenade = true;
        for (const { unit, damage, killed } of event.casualties) {
          const target = this.unit(unit)!;
          target.hp -= damage;
          if (killed) this.creditKill(u, target);
        }
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
      case "hostile-phase":
        this.phase = "enemy";
        for (const u of this.enemies) u.ap = 2;
        return;
      case "turn":
        this.phase = "player";
        this.turn = event.turn;
        for (const u of this.allies) {
          u.ap = 2;
          u.overwatch = false;
          u.hunkered = false;
        }
        return;
    }
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
        case "reload":
          return this.reload(u);
        // only whoever decides the game has anything lying around
        case "pick-up":
          return null;
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
  /** The name of a weapon lying on a cell, if there is one. */
  weaponAt(cell: Cell) {
    return this.authority?.dropped().find((d) => key(d.cell) === key(cell))?.name ?? null;
  }
  /** Whether a shot from one cell to another has a clear line. */
  shotBlocked(from: Cell, to: Cell) {
    return this.authority ? !this.authority.clearShot(from, to) : this.map.coverPeek(from, to).blocked;
  }
  /** Whether a throw from one cell can land on another. */
  throwBlocked(from: Cell, to: Cell) {
    return !!this.authority && !this.authority.clearThrow(from, to);
  }
  private groundOpen(p: Cell) {
    return this.authority ? this.authority.terrain(p) === "open" : this.map.open(p);
  }
  private groundCover(p: Cell) {
    return this.authority ? this.authority.terrain(p) === "cover" : this.map.isCover(p);
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
        if (!found.has(key(p)) && this.walkable(p, unit)) {
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
  canAct(u: Unit) {
    return (
      u.hp > 0 &&
      u.ap > 0 &&
      !this.result &&
      u.enemy === (this.phase === "enemy")
    );
  }
  move(u: Unit, p: Cell) {
    if (!this.canAct(u)) return null;
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
  chance(a: Unit, b: Unit) {
    if (this.authority) return this.authority.chance(a, b);
    const d = distance(a.pos, b.pos);
    if (d > a.range + 3 || this.map.coverPeek(a.pos, b.pos).blocked) return 0;
    return Math.max(
      0,
      Math.min(
        100,
        a.aim + (d < a.range ? (a.range - d) * 5 : -(d - a.range) * 10),
      ) - this.cover(b, a),
    );
  }
  /** Whether `a` has a line and the range to shoot `b` at all, AP aside. */
  private canShoot(a: Unit, b: Unit) {
    return (
      a.ammo > 0 &&
      b.hp > 0 &&
      a.enemy !== b.enemy &&
      distance(a.pos, b.pos) <= a.range + 3 &&
      !this.shotBlocked(a.pos, b.pos)
    );
  }
  attack(a: Unit, b: Unit) {
    if (!this.canAct(a) || !this.canShoot(a, b)) return null;
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
    const hit = this.random() * 100 < chance;
    const crit = hit && this.random() < 0.1;
    const damage = hit ? shotDamage(a, b, crit) : 0;
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
    if (!this.canAct(u) || u.ammo === u.clip) return false;
    this.emit({ type: "reload", unit: u.id });
    return true;
  }
  throwGrenade(u: Unit, p: Cell) {
    if (!this.canAct(u) || u.grenade || distance(u.pos, p) > 5) return false;
    const casualties = this.units
      .filter((t) => t.hp > 0 && distance(t.pos, p) <= 2)
      .map((t) => {
        const damage = Math.min(t.hp, Math.max(1, 6 - t.armor));
        return { unit: t.id, damage, killed: t.hp - damage === 0 };
      });
    const environment = this.map.blastProps(p);
    this.emit({ type: "grenade", unit: u.id, at: [...p], casualties, environment });
    return true;
  }
  secure(u: Unit) {
    if (!this.canAct(u) || this.secured || distance(u.pos, this.relay) > 0)
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
    if (!this.canAct(u)) return false;
    this.emit({ type: "hunker", unit: u.id });
    return true;
  }
  watch(u: Unit) {
    if (!this.canAct(u) || u.ammo < 1) return false;
    this.emit({ type: "overwatch", unit: u.id });
    return true;
  }
  beginEnemy() {
    this.emit({ type: "hostile-phase" });
  }
  nextTurn() {
    this.emit({ type: "turn", turn: this.turn + 1 });
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

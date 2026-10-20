import { CELL, tacticalMap, type Cell, type TacticalMap } from "./map.ts";
import { describe, type Command, type GameEvent } from "./events.ts";
import { blackRain, type Scenario } from "./scenario.ts";
// Local presentation simulation. Rules reference commander::{unit,map,stats}; no chain imports.
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
export class Encounter {
  readonly scenario: Scenario;
  readonly map: TacticalMap;
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
    this.map = tacticalMap(scenario.map);
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
  /** Record an event and write its feed line. */
  private emit(event: GameEvent) {
    this.events.push(event);
    const line =
      event.type === "secure"
        ? this.scenario.lines.secured
        : describe(event, (id) => this.unit(id)?.name ?? id);
    if (line) this.add(line);
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
        case "hunker":
          return this.hunker(u);
        case "overwatch":
          return this.watch(u);
        case "secure":
          return this.secure(u);
      }
    });
  }
  walkable(p: Cell, unit?: Unit) {
    return (
      this.map.open(p) &&
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
        } else if (this.map.isCover(p)) {
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
    u.pos = [...p];
    u.ap--;
    u.hunkered = false;
    u.overwatch = false;
    this.emit({
      type: "move",
      unit: u.id,
      path,
      vault: path.some((c) => this.map.isCover(c)),
      cover: this.cover(u) > 0,
    });
    return path;
  }
  /** Defense against `attacker` (or against anyone, without one): walls, barriers, hunkering. */
  cover(u: Unit, attacker?: Unit) {
    const map = this.map;
    const behindWall = attacker
      ? !map.clearBuildingShot(
          [attacker.pos[0] * CELL, attacker.pos[1] * CELL],
          [u.pos[0] * CELL, u.pos[1] * CELL],
        )
      : map.physicalCover(u.pos) === "high";
    if (map.highCoverAt(u.pos) && behindWall) return u.hunkered ? 60 : 40;
    const barrier = map.covers.some(
      (c) =>
        distance(c, u.pos) === 1 &&
        (!attacker || distance(c, attacker.pos) < distance(u.pos, attacker.pos)),
    );
    return barrier ? (u.hunkered ? 50 : 25) : u.hunkered ? 20 : 0;
  }
  chance(a: Unit, b: Unit) {
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
      !this.map.coverPeek(a.pos, b.pos).blocked
    );
  }
  attack(a: Unit, b: Unit) {
    if (!this.canAct(a) || !this.canShoot(a, b)) return null;
    a.ap = a.weapon === "pistol" ? a.ap - 1 : 0;
    return this.shoot(a, b, false);
  }
  /**
   * Overwatch: an ally who held fire takes one shot at a hostile moving in
   * reach, out of turn. The watch is spent even when the line is blocked.
   */
  reactionFire(ally: Unit, enemy: Unit) {
    if (!ally.overwatch || ally.hp <= 0 || this.phase !== "enemy") return null;
    ally.overwatch = false;
    ally.ap = 0;
    return this.canShoot(ally, enemy) ? this.shoot(ally, enemy, true) : null;
  }
  private shoot(a: Unit, b: Unit, reaction: boolean) {
    const chance = this.chance(a, b);
    a.hunkered = false;
    a.overwatch = false;
    a.ammo--;
    a.magazines[a.weapon] = a.ammo;
    const hit = this.random() * 100 < chance;
    const crit = hit && this.random() < 0.1;
    const damage = hit
      ? Math.max(1, a.damage + (crit ? Math.floor(a.damage / 2) : 0) - b.armor)
      : 0;
    b.hp = Math.max(0, b.hp - damage);
    const killed = hit && b.hp === 0;
    if (killed) this.creditKill(a, b);
    this.emit({ type: "shot", unit: a.id, target: b.id, hit, crit, damage, killed, reaction });
    return { hit, damage, crit };
  }
  reload(u: Unit) {
    if (!this.canAct(u) || u.ammo === u.clip) return false;
    u.ammo = u.clip;
    u.magazines[u.weapon] = u.ammo;
    u.ap--;
    this.emit({ type: "reload", unit: u.id });
    return true;
  }
  throwGrenade(u: Unit, p: Cell) {
    if (!this.canAct(u) || u.grenade || distance(u.pos, p) > 5) return false;
    u.ap--;
    u.grenade = true;
    const casualties: { unit: string; damage: number; killed: boolean }[] = [];
    for (const target of this.units.filter((t) => t.hp > 0 && distance(t.pos, p) <= 2)) {
      const damage = Math.min(target.hp, Math.max(1, 6 - target.armor));
      target.hp -= damage;
      if (target.hp === 0) this.creditKill(u, target);
      casualties.push({ unit: target.id, damage, killed: target.hp === 0 });
    }
    this.emit({ type: "grenade", unit: u.id, at: [...p], casualties });
    return true;
  }
  secure(u: Unit) {
    if (!this.canAct(u) || this.secured || distance(u.pos, this.relay) > 0)
      return false;
    u.ap--;
    this.secured = true;
    this.emit({ type: "secure", unit: u.id });
    return true;
  }
  switchWeapon(u: Unit, w: Weapon) {
    if (!this.canAct(u)) return false;
    u.magazines[u.weapon] = u.ammo;
    u.weapon = w;
    const stats = weapons[w];
    u.damage = stats.damage;
    u.range = stats.range;
    u.clip = stats.clip;
    u.aim = stats.aim;
    u.ammo = u.magazines[w];
    return true;
  }
  hunker(u: Unit) {
    if (!this.canAct(u)) return false;
    u.ap = 0;
    u.hunkered = true;
    u.overwatch = false;
    this.emit({ type: "hunker", unit: u.id });
    return true;
  }
  watch(u: Unit) {
    if (!this.canAct(u) || u.ammo < 1) return false;
    u.ap = 0;
    u.overwatch = true;
    u.hunkered = false;
    this.emit({ type: "overwatch", unit: u.id });
    return true;
  }
  beginEnemy() {
    this.phase = "enemy";
    for (const u of this.enemies) u.ap = 2;
    this.emit({ type: "hostile-phase" });
  }
  nextTurn() {
    this.phase = "player";
    this.turn++;
    for (const u of this.allies) {
      u.ap = 2;
      u.overwatch = false;
      u.hunkered = false;
    }
    this.emit({ type: "turn", turn: this.turn });
  }
  /** `reactionFire` as events, for the hostile phase. */
  react(ally: Unit, enemy: Unit): GameEvent[] {
    return this.record(() => this.reactionFire(ally, enemy));
  }
}

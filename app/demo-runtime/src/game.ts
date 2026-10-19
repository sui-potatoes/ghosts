import {highCoverAt,coverPeek,clearBuildingShot,physicalCover} from './high-cover.ts';
import { districtBuildings, CELL, lowCoverCells } from "./district-plan.ts";
// Local presentation simulation. Rules reference commander::{unit,map,stats}; no chain imports.
export type Cell = [number, number];
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
export const SIZE = { minX: -9, maxX: 8, minZ: -7, maxZ: 6 };
export const buildings = districtBuildings;
export const covers: Cell[] = lowCoverCells;
export const relay: Cell = [0, -2];
export const key = (p: Cell) => p.join(",");
export const distance = (a: Cell, b: Cell) =>
  Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
export const blocked = new Set<string>();
for (const b of buildings)
  for (
    let x = b.x - Math.floor(b.w / 2);
    x < b.x - Math.floor(b.w / 2) + b.w;
    x++
  )
    for (
      let z = b.z - Math.floor(b.d / 2);
      z < b.z - Math.floor(b.d / 2) + b.d;
      z++
    )
      blocked.add(key([x, z]));
for (const c of covers) blocked.add(key(c));
export function initialUnits(): Unit[] {
  const make = (
    id: string,
    name: string,
    full: string,
    role: Role,
    pos: Cell,
    color: string,
    enemy = false,
  ): Unit => ({
    id,
    name,
    full,
    role,
    enemy,
    pos,
    hp: enemy ? 9 : 12,
    maxHp: enemy ? 9 : 12,
    ap: 2,
    ammo: 3,
    clip: 3,
    armor: role === "HEAVY" ? 2 : 1,
    aim: role === "RECON" ? 85 : 78,
    range: role === "RECON" ? 10 : 8,
    mobility: role === "HEAVY" ? 5 : 7,
    damage: role === "HEAVY" ? 7 : 6,
    grenade: false,
    hunkered: false,
    overwatch: false,
    weapon: role === "RECON" ? "sniper" : "rifle",
    magazines: { rifle: 3, sniper: 3, pistol: 6 },
    color,
  });
  const units = [
    make("v", "VEX", "Mara Voss", "ASSAULT", [-3, 4], "#cdb77c"),
    make("g", "GHOST", "Ren Ishikawa", "RECON", [-1, 5], "#7eaaa7"),
    make("b", "BISHOP", "Elias Ward", "HEAVY", [1, 4], "#a4ad8d"),
    make("e", "ECHO", "Sana Okafor", "SPECIALIST", [-5, 3], "#ad92a6"),
    make(
      "h1",
      "WRAITH–01",
      "Kōra security",
      "ASSAULT",
      [2, -3],
      "#e77469",
      true,
    ),
    make("h2", "WRAITH–02", "Kōra security", "HEAVY", [5, -2], "#e77469", true),
    make(
      "h3",
      "WRAITH–03",
      "Kōra security",
      "RECON",
      [-3, -4],
      "#e77469",
      true,
    ),
  ];
  for (const u of units) {
    Object.assign(u, { ...weapons[u.weapon], name: u.name });
    u.ammo = u.magazines[u.weapon];
  }
  return units;
}
export class Encounter {
  units = initialUnits();
  // Encounter-local credit, shared by direct fire, overwatch and grenades.
  kills: Record<string, number> = {};
  turn = 1;
  phase: "player" | "enemy" = "player";
  secured = false;
  log: string[] = ["Ghosts squad deployed. Retrieve the relay core."];
  seed = 731;
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
  walkable(p: Cell, unit?: Unit) {
    return (
      p[0] >= SIZE.minX &&
      p[0] <= SIZE.maxX &&
      p[1] >= SIZE.minZ &&
      p[1] <= SIZE.maxZ &&
      !blocked.has(key(p)) &&
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
        } else if (covers.some((c) => key(c) === key(p))) {
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
    this.add(`${u.name} repositioned. −1 AP.`);
    return path;
  }
  cover(u: Unit, attacker?: Unit) {
    if(highCoverAt(u.pos) && (attacker ? !clearBuildingShot([attacker.pos[0]*CELL,attacker.pos[1]*CELL],[u.pos[0]*CELL,u.pos[1]*CELL]) : physicalCover(u.pos)==="high")) return u.hunkered ? 60 : 40;
    return covers.some(
      (c) =>
        distance(c, u.pos) === 1 &&
        (!attacker ||
          distance(c, attacker.pos) < distance(u.pos, attacker.pos)),
    )
      ? u.hunkered
        ? 50
        : 25
      : u.hunkered
        ? 20
        : 0;
  }
  chance(a: Unit, b: Unit) {
    const d = distance(a.pos, b.pos);
    if (d > a.range + 3 || coverPeek(a.pos,b.pos).blocked) return 0;
    return Math.max(
      0,
      Math.min(
        100,
        a.aim + (d < a.range ? (a.range - d) * 5 : -(d - a.range) * 10),
      ) - this.cover(b, a),
    );
  }
  attack(a: Unit, b: Unit) {
    if (
      !this.canAct(a) ||
      a.ammo < 1 ||
      b.hp <= 0 ||
      a.enemy === b.enemy ||
      distance(a.pos, b.pos) > a.range + 3 || coverPeek(a.pos,b.pos).blocked
    )
      return null;
    const chance = this.chance(a, b);
    a.ap = a.weapon === "pistol" ? a.ap - 1 : 0;
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
    if (b.hp === 0) this.creditKill(a, b);
    this.add(
      `${a.name} → ${b.name}: ${hit ? `${crit ? "CRITICAL / " : ""}${damage} damage${b.hp === 0 ? " / neutralized" : ""}` : "miss"}.`,
    );
    return { hit, damage, crit };
  }
  reload(u: Unit) {
    if (!this.canAct(u) || u.ammo === u.clip) return false;
    u.ammo = u.clip;
    u.magazines[u.weapon] = u.ammo;
    u.ap--;
    this.add(`${u.name} reloaded. −1 AP.`);
    return true;
  }
  throwGrenade(u: Unit, p: Cell) {
    if (!this.canAct(u) || u.grenade || distance(u.pos, p) > 5) return false;
    u.ap--;
    u.grenade = true;
    for (const target of this.units.filter(
      (t) => t.hp > 0 && distance(t.pos, p) <= 2,
    )) {
      target.hp = Math.max(0, target.hp - Math.max(1, 6 - target.armor));
      if (target.hp === 0) this.creditKill(u, target);
    }
    this.add(`${u.name} deployed fragmentation grenade. Blast radius: 2.`);
    return true;
  }
  secure(u: Unit) {
    if (!this.canAct(u) || this.secured || distance(u.pos, relay) > 1)
      return false;
    u.ap--;
    this.secured = true;
    this.add("Relay core acquired. Eliminate remaining hostiles.");
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
    this.add(`${u.name} hunkered down. Defense increased.`);
    return true;
  }
  watch(u: Unit) {
    if (!this.canAct(u) || u.ammo < 1) return false;
    u.ap = 0;
    u.overwatch = true;
    u.hunkered = false;
    this.add(`${u.name} on overwatch.`);
    return true;
  }
  beginEnemy() {
    this.phase = "enemy";
    for (const u of this.enemies) u.ap = 2;
  }
  nextTurn() {
    this.phase = "player";
    this.turn++;
    for (const u of this.allies) {
      u.ap = 2;
      u.overwatch = false;
      u.hunkered = false;
    }
    this.add(
      `Turn ${String(this.turn).padStart(2, "0")}. Ghosts has control.`,
    );
  }
}

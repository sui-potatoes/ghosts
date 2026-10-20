// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import { shortestAngle } from "../aim-transition";
import { aimClip } from "../combat-pose";
import type { Encounter, Unit } from "../game";
import type { Cell } from "../map";
import {
  aimHuman,
  play,
  resetHuman,
  restHuman,
  setWeapon as equipHuman,
  soldier,
  updateHuman,
  type Rig,
} from "../humans";
import { reactionMotion, reloadMotion, type Motion } from "../motions";
import { vaultProgress } from "../vault-motion";
import type { Effects } from "./effects";
import { UnitMarkers } from "./markers";
import { metal } from "./props";
import type { Animator, Space } from "./space";

export interface UnitsOptions {
  scene: T.Scene;
  /** Where name plates go; its data attributes carry the motion and cover phase for QA. */
  labels: HTMLElement;
  host: HTMLElement;
  game: () => Encounter;
  space: Space;
  animator: Animator;
  effects: Effects;
  onPick: (id: string) => void;
}

/** How a shot is framed: whether the shooter is already aimed, and the camera kick per tracer. */
export interface ShotFraming {
  aimed: boolean;
  kick?: (t: number) => void;
  afterTracer?: () => void;
}

/**
 * The operatives on the field: one rig per unit with its markers, and every
 * body animation the events call for (moving, vaulting, shooting, reloading,
 * throwing, hunkering, falling) plus the side-steps around high cover.
 */
export class Units {
  private readonly rigs = new Map<string, Rig>();
  private readonly markers: UnitMarkers;
  private readonly coverSequence = new Map<string, number>();

  constructor(private readonly o: UnitsOptions) {
    const game = o.game();
    for (const u of game.units) {
      const r = soldier(u);
      o.scene.add(r.root);
      this.rigs.set(u.id, r);
      this.place(u);
    }
    this.markers = new UnitMarkers(o.scene, o.labels, game.units, o.onPick, (x, z) => o.space.ground(x, z));
  }

  private get game() {
    return this.o.game();
  }

  private get map() {
    return this.o.space.map;
  }

  private vec(cell: Cell, y = 0) {
    return this.o.space.vec(cell, y);
  }

  rig(id: string): Rig | undefined {
    return this.rigs.get(id);
  }

  /** True while any rig is in a motion the loop must keep rendering. */
  get busy() {
    for (const r of this.rigs.values()) if (r.busy) return true;
    return false;
  }

  /** Stand a unit on its cell, facing the nearest opponent. */
  place(u: Unit) {
    const r = this.rigs.get(u.id)!;
    r.root.position.copy(this.vec(u.pos));
    const opponent = this.game.units
      .filter((v) => v.enemy !== u.enemy)
      .sort((a, b) => this.vec(a.pos).distanceToSquared(r.root.position) - this.vec(b.pos).distanceToSquared(r.root.position))[0];
    r.root.rotation.y = Math.atan2(u.pos[0] - opponent.pos[0], u.pos[1] - opponent.pos[1]);
  }

  /** Every rig out of its pose and back on its start cell. */
  redeploy() {
    for (const u of this.game.units) {
      resetHuman(this.rigs.get(u.id)!);
      this.place(u);
    }
  }

  /** Bring rigs and markers in line with the rules; `aiming` leaves poses to the aim camera. */
  sync(selected: string, aiming: boolean) {
    for (const u of this.game.units) {
      const r = this.rigs.get(u.id)!;
      this.markers.sync(u, u.id === selected);
      if (u.hp <= 0 && !r.dead && !r.busy) {
        void this.reaction(u);
      } else if (u.hp > 0) {
        if (!r.busy) equipHuman(r, u.weapon);
        if (!r.busy && !aiming) this.rest(u);
      }
    }
  }

  /** Per frame: skeletons, then markers over the bodies. */
  update(dt: number, camera: T.Camera, width: number, height: number) {
    for (const u of this.game.units) {
      const r = this.rigs.get(u.id)!;
      if (!r.dead || r.action?.isRunning()) updateHuman(r, dt, this.map.surfaceHeight);
      this.markers.place(u, r.root.position, camera, width, height);
    }
  }

  /** Points the camera must keep in view: chest height of every living unit. */
  chestPoints(into: T.Vector3[]): T.Vector3[] {
    const points: T.Vector3[] = [];
    let sample = 0;
    for (const u of this.game.units) {
      if (u.hp <= 0) continue;
      const rig = this.rigs.get(u.id);
      if (!rig) continue;
      const point = (into[sample++] ??= new T.Vector3());
      point.copy(rig.root.position);
      point.y += 1.05;
      points.push(point);
    }
    return points;
  }

  rest(u: Unit) {
    const rig = this.rigs.get(u.id)!,
      stance = this.map.coverStance(u.pos);
    if (stance.heading !== null && !u.overwatch) rig.root.rotation.y = stance.heading;
    restHuman(rig, u, stance.kind);
  }

  /** Play a clip to its end. */
  async clip(r: Rig, name: Motion, speed = 1) {
    this.o.host.dataset.motion = name;
    await this.o.animator.tween(play(r, name, true, speed), () => {});
  }

  /** Run `fn` with the rig marked busy, then settle `u` into its resting pose. */
  private async busyWith(u: Unit, fn: (r: Rig) => Promise<void>) {
    const r = this.rigs.get(u.id)!;
    r.busy = true;
    await fn(r);
    r.busy = false;
    this.rest(u);
  }

  move(u: Unit, path: Cell[]) {
    const { animator } = this.o;
    return this.busyWith(u, async (r) => {
      if (this.map.physicalCover(path[0]) === "low") await this.clip(r, "crouch_exit", 1.6);
      for (let i = 1; i < path.length; i++) {
        const start = r.root.position.clone();
        let end = this.vec(path[i]);
        const vault = this.map.isCover(path[i]);
        const coveredStep = !vault && this.map.wallTravel(path[i - 1], path[i]);
        let seconds = coveredStep ? 0.72 : 0.24;
        if (vault && i + 1 < path.length) {
          end = this.vec(path[++i]);
          seconds = play(r, "vault", true, 1, 0.1);
        } else if (coveredStep) {
          const step = this.map.coverStep(path[i - 1], [start.x, start.z], [end.x, end.z]);
          r.root.rotation.y = step.heading;
          play(r, step.motion, true, r.clips.get(step.motion)!.duration / seconds, 0.12);
        } else play(r, "rifle_run", false, 1);
        // Side-stepping keeps the torso facing the cover; running faces travel.
        if (!coveredStep) r.root.rotation.y = Math.atan2(start.x - end.x, start.z - end.z);
        await animator.tween(seconds, (t) => r.root.position.copy(start).lerp(end, vault ? vaultProgress(t) : t), false);
      }
      const stance = this.map.coverStance(u.pos);
      if (stance.heading !== null) {
        const start = r.root.rotation.y,
          turn = shortestAngle(start, stance.heading);
        await animator.tween(0.2, (t) => (r.root.rotation.y = start + turn * t));
      }
      if (stance.kind === "low") await this.clip(r, "crouch_enter", 1.8);
    });
  }

  /** Hit reaction, or the fall when `u` is down. */
  async reaction(u: Unit, heavy = false) {
    const r = this.rigs.get(u.id)!;
    if (r.dead) return;
    r.busy = true;
    if (u.hp <= 0) {
      r.dead = true;
      this.markers.hide(u.id);
    }
    await this.clip(r, reactionMotion(r.dead, this.game.cover(u) > 0, heavy), 1.35);
    r.busy = false;
    if (!r.dead) this.rest(u);
  }

  async fire(a: Unit, b: Unit, hit: boolean, framing: ShotFraming) {
    const { animator, effects } = this.o;
    const r = this.rigs.get(a.id)!;
    r.busy = true;
    const target = this.vec(b.pos, 1);
    r.aimTarget = target.clone();
    const from = r.root.position;
    r.root.rotation.y = Math.atan2(from.x - target.x, from.z - target.z);
    const wall = this.map.physicalCover(a.pos) === "high";
    const covered = this.game.cover(a) > 0 && !wall;
    if (!framing.aimed) {
      if (wall) await this.exposeCorner(a, b.pos);
      r.root.rotation.y = Math.atan2(r.root.position.x - target.x, r.root.position.z - target.z);
      if (covered && a.weapon !== "pistol") await animator.tween(play(r, "covered_rise", true), () => {});
      aimHuman(r, covered);
      await animator.tween(0.28, () => {});
    }
    const shotMotion = aimClip(a.weapon, covered);
    const shotDuration = play(r, shotMotion, true, 1, 0.08);
    this.o.host.dataset.motion = shotMotion;
    const reaction = hit ? this.reaction(b, a.weapon === "sniper") : Promise.resolve();
    const shots = a.weapon === "rifle" ? 3 : 1;
    for (let i = 0; i < shots; i++) {
      const origin = r.gun.getWorldPosition(new T.Vector3());
      origin.add(target.clone().sub(origin).normalize().multiplyScalar(0.35));
      await effects.tracer(origin, target, a.enemy, framing.kick);
      framing.afterTracer?.();
      await animator.tween(0.1, () => {});
    }
    await animator.tween(Math.max(0.15, shotDuration - shots * 0.2), () => {});
    await reaction;
    r.aimTarget = null;
    if (covered && a.weapon !== "pistol") await animator.tween(play(r, "covered_return", true), () => {});
    if (wall) await this.withdrawCorner(a);
    this.rest(a);
    await animator.tween(0.3, () => {});
    r.busy = false;
  }

  reload(u: Unit) {
    return this.busyWith(u, (r) => this.clip(r, reloadMotion(u.weapon, this.game.cover(u) > 0), 1.35));
  }

  grenade(u: Unit, p: Cell) {
    const { animator, effects } = this.o;
    return this.busyWith(u, async (r) => {
      const target = this.vec(p, 0.2);
      r.root.rotation.y = Math.atan2(r.root.position.x - target.x, r.root.position.z - target.z);
      const duration = play(r, "toss_grenade", true, 1.25);
      r.gun.visible = true;
      await animator.tween(duration * 0.43, () => {});
      await effects.lob(r.hand.getWorldPosition(new T.Vector3()), target, metal);
      await effects.explosion(target);
      await Promise.all(
        this.game.units
          .filter(
            (v) =>
              v.id !== u.id &&
              Math.abs(v.pos[0] - p[0]) + Math.abs(v.pos[1] - p[1]) <= 2 &&
              !this.rigs.get(v.id)!.dead,
          )
          .map((v) => this.reaction(v, true)),
      );
      r.gun.visible = true;
    });
  }

  hunker(u: Unit) {
    return this.busyWith(u, async (r) => {
      await this.clip(r, "crouch_enter", 1.8);
      await this.clip(r, "hunker_down");
    });
  }

  watch(u: Unit) {
    return this.busyWith(u, async (r) => {
      if (this.game.cover(u)) await this.clip(r, "crouch_exit", 1.8);
      await this.clip(r, "overwatch_ready");
    });
  }

  // === Cover steps (high-cover corners) ===

  private nextCoverToken(id: string) {
    const token = (this.coverSequence.get(id) ?? 0) + 1;
    this.coverSequence.set(id, token);
    return token;
  }

  /** Side-step from `start` to `end` along a wall; `live` says whether to keep going. */
  private async coverWalk(u: Unit, rig: Rig, start: T.Vector3, end: T.Vector3, token: number, live: () => boolean) {
    const { animator, host } = this.o;
    const step = this.map.coverStep(u.pos, [start.x, start.z], [end.x, end.z]);
    host.dataset.coverSide = step.side;
    const from = rig.root.rotation.y,
      delta = Math.atan2(Math.sin(step.heading - from), Math.cos(step.heading - from));
    await animator.tween(0.16, (t) => {
      if (this.coverSequence.get(u.id) === token) rig.root.rotation.y = from + delta * t;
    });
    if (!live()) return;
    const duration = 0.72;
    play(rig, step.motion, true, rig.clips.get(step.motion)!.duration / duration, 0.12);
    await animator.tween(duration, (t) => {
      if (!live()) return;
      rig.root.position.copy(start).lerp(end, t);
      rig.root.position.y = this.map.surfaceHeight(rig.root.position.x, rig.root.position.z);
    });
  }

  /** Step out from high cover to the corner that sees `point`; `stillWanted` cancels a stale step. */
  async exposeCorner(u: Unit, point: Cell, stillWanted: () => boolean = () => true) {
    const { host } = this.o;
    const rig = this.rigs.get(u.id)!,
      plan = this.map.coverPeek(u.pos, point);
    const token = this.nextCoverToken(u.id);
    if (!plan.high || plan.blocked) return;
    host.dataset.coverPhase = "stepping-out";
    const end = new T.Vector3(plan.position[0], this.map.surfaceHeight(...plan.position), plan.position[1]);
    const start = rig.root.position.clone();
    if (start.distanceTo(end) < 0.025) {
      host.dataset.coverPhase = "exposed";
      return;
    }
    await this.coverWalk(u, rig, start, end, token, () => this.coverSequence.get(u.id) === token && stillWanted());
    if (this.coverSequence.get(u.id) === token) host.dataset.coverPhase = "exposed";
  }

  /** Back from the corner to the unit's own cell. */
  async withdrawCorner(u: Unit) {
    const rig = this.rigs.get(u.id)!,
      start = rig.root.position.clone(),
      end = this.vec(u.pos);
    const token = this.nextCoverToken(u.id);
    if (start.distanceTo(end) < 0.025) return;
    this.o.host.dataset.coverPhase = "withdrawing";
    await this.coverWalk(u, rig, start, end, token, () => this.coverSequence.get(u.id) === token);
    if (this.coverSequence.get(u.id) === token) this.o.host.dataset.coverPhase = "sheltered";
  }

  /** Shaders for weapons that start hidden; returns a restore function. */
  showAllWeapons(): () => void {
    const hidden: T.Object3D[] = [];
    for (const r of this.rigs.values())
      for (const o of [r.rifle, r.pistol, r.scope])
        if (!o.visible) {
          hidden.push(o);
          o.visible = true;
        }
    return () => {
      for (const o of hidden) o.visible = false;
    };
  }

  dispose() {
    this.markers.dispose();
  }
}

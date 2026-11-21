// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import type { ThrowOrder } from "../action-registry";
import { BLAST_TILES, blastTiles, FLASH, FLASH_TINT, flashLevel, tileWeight } from "../blast-flash";
import { distance } from "../game";
import { CELL, type Cell, type TacticalMap } from "../map";
import type { Job } from "./clock";

/** Height over the ground: above the aim preview's burst wash (0.085) and its rings (0.095). */
const LIFT = 0.1;

/**
 * The ground flash of a grenade going off: every tile of its burst lights at
 * the moment of detonation and fades out. One instanced draw, one set of
 * buffers made up front; a frame only sets the material's opacity. A new burst
 * replaces one still fading. It runs as a scene job, so it follows the replay's
 * speed, holds when paused and finishes when a step is flushed.
 */
export class BlastFlash {
  readonly group = new T.Group();
  private readonly mesh: T.InstancedMesh<T.PlaneGeometry, T.MeshBasicMaterial>;
  private readonly tints: Record<"frag" | "flashbang" | "smoke", T.Color>;
  private readonly scratch = new T.Object3D();
  private readonly shade = new T.Color();
  private elapsed = 0;
  private calm = false;
  private active = false;
  /** The fade's job is on the clock (it may outlive a `clear` by a frame). */
  private queued = false;

  /** `tints`: CSS colours for each kind; `run` schedules a scene job; `redraw` asks for a frame. */
  constructor(
    tints: Record<"frag" | "flashbang" | "smoke", string>,
    private readonly run: (job: Job) => void,
    private readonly redraw: () => void,
  ) {
    const material = new T.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: T.AdditiveBlending,
      side: T.DoubleSide,
      fog: false,
    });
    this.mesh = new T.InstancedMesh(new T.PlaneGeometry(CELL * 0.93, CELL * 0.93).rotateX(-Math.PI / 2), material, BLAST_TILES);
    this.mesh.name = "BlastFlash";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.group.add(this.mesh);
    this.tints = {
      frag: new T.Color(tints.frag),
      flashbang: new T.Color(tints.flashbang),
      smoke: new T.Color(tints.smoke),
    };
  }

  /** Whether a flash is on the ground. */
  get lit() {
    return this.active;
  }

  /** The grenade of `kind` has gone off on `at`: light its burst. */
  fire(map: TacticalMap, at: Cell, kind: ThrowOrder, calm: boolean) {
    const tiles = blastTiles(map, at);
    this.mesh.material.color.copy(this.tints[FLASH_TINT[kind]]);
    tiles.forEach((cell, i) => {
      const x = cell[0] * CELL,
        z = cell[1] * CELL;
      this.scratch.position.set(x, map.surfaceHeight(x, z) + LIFT, z);
      this.scratch.updateMatrix();
      this.mesh.setMatrixAt(i, this.scratch.matrix);
      this.mesh.setColorAt(i, this.shade.setScalar(tileWeight(distance(cell, at))));
    });
    this.mesh.count = tiles.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.elapsed = 0;
    this.calm = calm;
    this.active = tiles.length > 0;
    this.show(this.active);
    if (this.active && !this.queued) {
      this.queued = true;
      this.run(this.job);
    }
    this.redraw();
  }

  /** Put the ground back at once (a seek, a redeploy). */
  clear() {
    this.show(false);
    this.active = false;
    this.redraw();
  }

  dispose() {
    this.group.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.dispose();
  }

  private show(on: boolean) {
    this.mesh.visible = on;
    if (on) this.mesh.material.opacity = FLASH.peak * flashLevel(0, this.calm);
  }

  /** One step of the fade; true once it is gone (or was cleared). */
  private readonly job: Job = (dt) => {
    if (!this.active) return (this.queued = false);
    this.elapsed += dt;
    const level = flashLevel(this.elapsed, this.calm);
    this.mesh.material.opacity = FLASH.peak * level;
    if (this.elapsed >= FLASH.duration) {
      this.mesh.visible = false;
      this.active = false;
    }
    this.redraw();
    if (this.active) return false;
    this.queued = false;
    return true;
  };
}

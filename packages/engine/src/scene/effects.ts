// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import { amber } from "./props";
import { sceneRandom, type Animator } from "./space";

/** The player asked for less motion (the shell's Reduce motion, or the system's). */
export function reducedMotion(): boolean {
  if (typeof document !== "undefined" && document.documentElement.dataset.reduceMotion === "on") return true;
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const SMOKE = 0xb7c0c4;
let puffTexture: T.Texture | null = null;

/** A soft round puff, white at the centre and gone at the rim; one shared texture. */
function puff(): T.Texture | null {
  if (puffTexture || typeof document === "undefined") return puffTexture;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const g = canvas.getContext("2d");
  if (!g) return null;
  const gradient = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.55, "rgba(255,255,255,0.45)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gradient;
  g.fillRect(0, 0, 64, 64);
  puffTexture = new T.CanvasTexture(canvas);
  return puffTexture;
}

/** A cluster of soft puffs, `count` of them within `spread` metres, `size` across. */
function smokeCloud(count: number, spread: number, size: number, opacity: number) {
  const group = new T.Group();
  const material = new T.SpriteMaterial({ map: puff(), color: SMOKE, transparent: true, opacity, depthWrite: false, fog: true });
  for (let i = 0; i < count; i++) {
    const sprite = new T.Sprite(material);
    const angle = (i / count) * Math.PI * 2 + sceneRandom() * 0.6;
    const r = spread * (0.35 + sceneRandom() * 0.65);
    sprite.position.set(Math.cos(angle) * r, 0.35 + sceneRandom() * 1.1, Math.sin(angle) * r);
    sprite.scale.setScalar(size * (0.75 + sceneRandom() * 0.5));
    group.add(sprite);
  }
  group.userData.material = material;
  return group;
}

/** Short-lived combat effects drawn into the `fx` group with one shared point light. */
export class Effects {
  readonly group = new T.Group();
  readonly light = new T.PointLight(0xffbc70, 0, 12);
  /** The smoke hanging around each unit in smoke, by unit id; it follows the unit until the effect ends. */
  private readonly lingering = new Map<string, T.Group>();

  constructor(private readonly animator: Animator) {}

  /**
   * The flashbang going off at `p`: one bright white pulse that dies fast. With
   * Reduce motion it is a soft, slower fade instead. Never more than one pulse.
   */
  async flash(p: T.Vector3) {
    const calm = reducedMotion();
    const flash = this.light;
    const peak = calm ? 14 : 90;
    flash.color.set(0xf4f8ff);
    flash.intensity = peak;
    flash.distance = 14;
    flash.position.copy(p).add(new T.Vector3(0, 1, 0));
    const core = new T.Mesh(
      new T.SphereGeometry(1, 20, 14),
      new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: calm ? 0.35 : 0.95, depthWrite: false, fog: false }),
    );
    core.position.copy(p).add(new T.Vector3(0, 0.6, 0));
    core.scale.setScalar(calm ? 1.2 : 0.3);
    this.group.add(core);
    await this.animator.tween(calm ? 0.9 : 0.35, (t) => {
      const fade = calm ? 1 - t : Math.pow(1 - t, 2);
      flash.intensity = peak * fade;
      (core.material as T.MeshBasicMaterial).opacity = (calm ? 0.35 : 0.95) * fade;
      if (!calm) core.scale.setScalar(0.3 + t * 1.6);
    }, false);
    this.group.remove(core);
    flash.intensity = 0;
    core.geometry.dispose();
    (core.material as T.Material).dispose();
  }

  /** The smoke grenade bursting at `p`: a cloud that billows out over the burst and thins to what lingers. */
  async smokeBurst(p: T.Vector3) {
    const calm = reducedMotion();
    const cloud = smokeCloud(18, 2.2, 2.4, 0.5);
    cloud.position.copy(p);
    this.group.add(cloud);
    const material = cloud.userData.material as T.SpriteMaterial;
    await this.animator.tween(calm ? 0.6 : 1.1, (t) => {
      cloud.scale.setScalar(calm ? 1 : 0.3 + t * 0.7);
      material.opacity = 0.5 * (1 - t * 0.85);
    });
    this.group.remove(cloud);
    material.dispose();
  }

  /**
   * The lingering smoke: one cloud on every unit id in `ids`, none on the rest.
   * Each follows its unit (`placeLingering`); it goes when the effect ends or
   * the unit falls. Returns whether anything changed.
   */
  syncLingering(ids: ReadonlySet<string>): boolean {
    let changed = false;
    for (const [id, cloud] of this.lingering) {
      if (ids.has(id)) continue;
      this.group.remove(cloud);
      (cloud.userData.material as T.Material).dispose();
      this.lingering.delete(id);
      changed = true;
    }
    for (const id of ids) {
      if (this.lingering.has(id)) continue;
      const cloud = smokeCloud(7, 0.7, 1.5, 0.3);
      cloud.name = `smoke:${id}`;
      cloud.visible = false;
      this.group.add(cloud);
      this.lingering.set(id, cloud);
      changed = true;
    }
    return changed;
  }

  /** Keep a unit's lingering smoke on it. */
  placeLingering(id: string, at: T.Vector3) {
    const cloud = this.lingering.get(id);
    if (!cloud) return;
    cloud.position.copy(at);
    cloud.visible = true;
  }

  /** Which units have smoke around them now: for QA and tests. */
  get lingeringIds(): string[] {
    return [...this.lingering.keys()];
  }

  /** A tracer from `origin` to `target` with a muzzle flash; `onFrame` runs each tick (camera kick). */
  async tracer(origin: T.Vector3, target: T.Vector3, hostile: boolean, onFrame?: (t: number) => void) {
    const tracer = new T.Line(
      new T.BufferGeometry().setFromPoints([origin, target]),
      new T.LineBasicMaterial({ color: hostile ? 0xff8068 : 0xffdd9a, transparent: true, opacity: 1 }),
    );
    this.group.add(tracer);
    this.light.color.set(0xffc56f);
    this.light.intensity = 12;
    this.light.distance = 4;
    this.light.position.copy(origin);
    await this.animator.tween(0.1, (t) => {
      onFrame?.(t);
      (tracer.material as T.LineBasicMaterial).opacity = 1 - t;
    });
    this.group.remove(tracer);
    this.light.intensity = 0;
    tracer.geometry.dispose();
    (tracer.material as T.Material).dispose();
  }

  /** A grenade lobbed from `start` to `target` in an arc. */
  async lob(start: T.Vector3, target: T.Vector3, material: T.Material) {
    const ball = new T.Mesh(new T.SphereGeometry(0.075, 12, 10), material);
    this.group.add(ball);
    await this.animator.tween(0.75, (t) => {
      ball.position.copy(start).lerp(target, t);
      ball.position.y += Math.sin(Math.PI * t) * 2.5;
    });
    this.group.remove(ball);
    ball.geometry.dispose();
  }

  /** Blast cloud, flash and debris at `p`. */
  async explosion(p: T.Vector3) {
    const flash = this.light;
    flash.color.set(0xffa24e);
    flash.intensity = 40;
    flash.distance = 12;
    flash.position.copy(p).add(new T.Vector3(0, 1, 0));
    const cloud = new T.Mesh(
      new T.SphereGeometry(1, 16, 12),
      new T.MeshBasicMaterial({ color: 0xffaa65, transparent: true, opacity: 0.8, wireframe: true }),
    );
    cloud.position.copy(p);
    this.group.add(cloud);
    const particles: { mesh: T.Mesh; velocity: T.Vector3 }[] = [];
    for (let i = 0; i < 24; i++) {
      const mesh = new T.Mesh(new T.BoxGeometry(0.07, 0.07, 0.07), amber);
      mesh.position.copy(p);
      this.group.add(mesh);
      particles.push({
        mesh,
        velocity: new T.Vector3((sceneRandom() - 0.5) * 6, sceneRandom() * 4, (sceneRandom() - 0.5) * 6),
      });
    }
    await this.animator.tween(0.75, (t) => {
      cloud.scale.setScalar(0.2 + t * 2.7);
      (cloud.material as T.MeshBasicMaterial).opacity = 0.8 * (1 - t);
      flash.intensity = 40 * (1 - t);
      for (const part of particles) {
        part.mesh.position.copy(p).addScaledVector(part.velocity, t);
        part.mesh.position.y += 1 - 2 * t * t;
      }
    });
    this.group.remove(cloud);
    flash.intensity = 0;
    cloud.geometry.dispose();
    (cloud.material as T.Material).dispose();
    for (const part of particles) {
      this.group.remove(part.mesh);
      part.mesh.geometry.dispose();
    }
  }
}

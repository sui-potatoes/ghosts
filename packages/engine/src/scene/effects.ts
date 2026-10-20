// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import { amber } from "./props";
import { sceneRandom, type Animator } from "./space";

/** Short-lived combat effects drawn into the `fx` group with one shared point light. */
export class Effects {
  readonly group = new T.Group();
  readonly light = new T.PointLight(0xffbc70, 0, 12);

  constructor(private readonly animator: Animator) {}

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

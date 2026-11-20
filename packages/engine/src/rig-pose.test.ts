// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
// @ts-ignore Native contact helpers.
import { applyPose, fitTerrainFeet, restoreTerrainPose } from "./terrain-contact.js";

/**
 * A rig's pose invariant: whatever cut the animation (a seek's snap, a held
 * pose, a fallen body placed at once), the bones show the pose the mixer holds,
 * never hips and legs left from an earlier frame. The field fits the feet to
 * uneven ground (a curb, a ramp) every frame and undoes the fit before the next
 * mixer update; the mixer writes a bone only when its value changed, so a pose
 * applied outside the frame loop must undo the fit first, or the next frame's
 * undo writes the old standing hips onto it and nothing ever writes them back:
 * a body lying at hip height, "floating", for as long as it lies there.
 *
 * The rig is a small stand-in for the native skeleton (the names the contact
 * helpers look for, a sole to sample), stepped the way `updateHuman` steps it.
 */

const STAND = 0.9;
const LIE = 0.15;
const CROUCH = 0.5;
/** A curb under the left foot: x > 0 is 16 cm up. */
const curb = (x: number) => (x > 0 ? 0.16 : 0);

function rig() {
  const root = new T.Group(),
    model = new T.Group();
  root.add(model);
  const bone = (name: string, parent: T.Object3D, x: number, y: number, z: number) => {
    const b = new T.Bone();
    b.name = `mixamorig${name}`;
    b.position.set(x, y, z);
    parent.add(b);
    return b;
  };
  const hips = bone("Hips", model, 0, STAND, 0);
  bone("Spine", hips, 0, 0.5, 0);
  const bones = [hips];
  const feet: T.Bone[] = [];
  for (const [side, x] of [["Left", 0.1], ["Right", -0.1]] as const) {
    const up = bone(`${side}UpLeg`, hips, x, 0, 0),
      knee = bone(`${side}Leg`, up, 0, -0.45, 0),
      foot = bone(`${side}Foot`, knee, 0, -0.43, 0),
      toe = bone(`${side}ToeBase`, foot, 0, -0.02, 0.12);
    bones.push(up, knee, foot, toe);
    feet.push(foot, toe);
  }
  root.updateMatrixWorld(true);
  // Soles: heel and toe on each side, bound to the foot and toe bones.
  const sole: number[] = [], index: number[] = [], weight: number[] = [];
  for (const b of feet) {
    const p = b.getWorldPosition(new T.Vector3());
    sole.push(p.x, 0, p.z);
    index.push(bones.indexOf(b), 0, 0, 0);
    weight.push(1, 0, 0, 0);
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.Float32BufferAttribute(sole, 3));
  geometry.setAttribute("skinIndex", new T.Uint16BufferAttribute(index, 4));
  geometry.setAttribute("skinWeight", new T.Float32BufferAttribute(weight, 4));
  const mesh = new T.SkinnedMesh(geometry, new T.MeshBasicMaterial());
  mesh.name = "Blackline_Face";
  model.add(mesh);
  mesh.bind(new T.Skeleton(bones));
  // Clips: a hips height and lean each; the legs are keyed so the mixer owns them, as the native clips do.
  const still = (name: string, height: number, lean: number) => {
    const q = new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), lean).toArray();
    const legs = bones.slice(1).map((b) => new T.QuaternionKeyframeTrack(`${b.name}.quaternion`, [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]));
    return new T.AnimationClip(name, 1, [
      new T.VectorKeyframeTrack("mixamorigHips.position", [0, 1], [0, height, 0, 0, height, 0]),
      new T.QuaternionKeyframeTrack("mixamorigHips.quaternion", [0, 1], [...q, ...q]),
      ...legs,
    ]);
  };
  const clips = { idle: still("idle", STAND, 0), death: still("death", LIE, Math.PI / 2), crouch: still("crouch", CROUCH, 0.3) };
  const mixer = new T.AnimationMixer(model);
  const r = { root, model, mixer, hips, action: mixer.clipAction(clips.idle).play() };
  /** One frame as `updateHuman` runs it: undo the fit, mix, fit the feet unless dead. */
  const frame = (dt: number, dead = false) => {
    restoreTerrainPose(model);
    mixer.update(dt);
    root.updateMatrixWorld(true);
    if (!dead) fitTerrainFeet(model, root, curb);
  };
  /** `holdHuman`, then `settlePose`: `name` at its last frame, at once, with `apply` putting the mix on the bones. */
  const hold = (name: keyof typeof clips, apply: () => void) => {
    const previous = r.action,
      next = mixer.clipAction(clips[name]);
    next.reset().setLoop(T.LoopOnce, 1).play();
    previous.fadeOut(0.24);
    next.fadeIn(0.24);
    next.time = clips[name].duration;
    next.paused = true;
    r.action = next;
    apply();
    previous.stop();
    next.stopFading().setEffectiveWeight(1);
    apply();
  };
  const hipsHeight = () => r.hips.getWorldPosition(new T.Vector3()).y - root.position.y;
  return { ...r, frame, hold, hipsHeight };
}

const poseNow = (r: ReturnType<typeof rig>) => () => applyPose(r.model, r.mixer);
const bare = (r: ReturnType<typeof rig>) => () => r.mixer.update(0);

test("a stand-in rig on a curb has its feet fitted, as the field's rigs do", () => {
  const r = rig();
  for (let i = 0; i < 5; i++) r.frame(1 / 60);
  assert.ok(r.model.userData.terrainPose, "uneven ground keeps a fit to undo");
  assert.ok(r.hipsHeight() < STAND, "the fit lowers the hips onto the lower foot");
});

test("a body placed already fallen lies on the ground (seek to a turn after a kill)", () => {
  const r = rig();
  for (let i = 0; i < 5; i++) r.frame(1 / 60);
  r.hold("death", poseNow(r));
  // Dead and held: the field steps it once (`placeFallen`), then stops stepping it.
  r.frame(0, true);
  assert.ok(Math.abs(r.hipsHeight() - LIE) < 1e-3, `hips at ${r.hipsHeight().toFixed(3)} m, lying is ${LIE}`);
  // A repaint later changes nothing.
  r.frame(0, true);
  assert.ok(Math.abs(r.hipsHeight() - LIE) < 1e-3);
});

test("the old snap left the fallen body's hips at standing height (the floating body)", () => {
  const r = rig();
  for (let i = 0; i < 5; i++) r.frame(1 / 60);
  r.hold("death", bare(r));
  r.frame(0, true);
  assert.ok(r.hipsHeight() > LIE + 0.5, "without undoing the fit first, the stale hips stay up");
});

test("a held pose snapped on a curb shows that pose on every frame after (hunkered, on watch, aiming)", () => {
  const r = rig();
  for (let i = 0; i < 5; i++) r.frame(1 / 60);
  r.hold("crouch", poseNow(r));
  for (let i = 0; i < 10; i++) {
    r.frame(1 / 60);
    // The fit only ever lowers the hips onto the lower foot; never the old standing height.
    assert.ok(r.hipsHeight() <= CROUCH + 1e-3, `frame ${i}: hips at ${r.hipsHeight().toFixed(3)} m over a ${CROUCH} m crouch`);
  }
});

test("a held pose snapped back to standing stands again", () => {
  const r = rig();
  r.hold("crouch", poseNow(r));
  for (let i = 0; i < 5; i++) r.frame(1 / 60);
  r.hold("idle", poseNow(r));
  r.frame(1 / 60);
  assert.ok(r.hipsHeight() > CROUCH + 0.2, `hips at ${r.hipsHeight().toFixed(3)} m after standing up`);
});

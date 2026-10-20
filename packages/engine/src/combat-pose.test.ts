// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AnimationClip,
  QuaternionKeyframeTrack,
  VectorKeyframeTrack,
} from "three";
import { combatClips } from "./combat-pose.ts";
test("cropped firing clips retain constant bone tracks and sample both boundaries", () => {
  const source = ["shooting", "crouch_shooting", "pistol_shot"].map(
    (name) =>
      new AnimationClip(name, 3, [
        // Rebased pistol clips require the authored pelvis and spine rotations.
        ...["mixamorigHips", "mixamorigSpine"].map((bone) =>
          new QuaternionKeyframeTrack(bone + ".quaternion", [0, 3],
            [0, 0, 0, 1, 0, 0, 0, 1])),
        new QuaternionKeyframeTrack(
          "mixamorigLeftHandMiddle1.quaternion",
          [0, 3],
          [0, 0, 0, 1, 0, 0, 0, 1],
        ),
        new VectorKeyframeTrack(
          "mixamorigHips.position",
          [0, 3],
          [0, 0, 0, 0, 30, 0],
        ),
      ]),
  );
  const result = combatClips(source).find(
    (c) => c.name === "covered_rifle_fire",
  )!;
  const hand = result.tracks.find((t) => t.name.includes("Middle1"))!;
  assert.ok(
    hand,
    "constant finger track cannot disappear when the source is cropped",
  );
  assert.deepEqual(Array.from(hand.times), [0, 0.5]);
  assert.deepEqual(Array.from(hand.values), [0, 0, 0, 1, 0, 0, 0, 1]);
  const hips = result.tracks.find((t) => t.name === "mixamorigHips.position")!;
  assert.equal(hips.values[1], 9.5);
  assert.equal(hips.values[4], 14.5);
});

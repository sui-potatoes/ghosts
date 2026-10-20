// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import { Vector3, Quaternion } from "three";
import { portraitCameraPose } from "./portrait-frame.ts";
test("portrait camera stays level with the eyes while orbiting a pitched head", () => {
  const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.3);
  const frame = {
    center: new Vector3(0.1, 1.7, -0.1),
    up: new Vector3(0, 1, 0).applyQuaternion(q),
    forward: new Vector3(0, 0, -1).applyQuaternion(q),
  };
  for (const close of [true, false])
    for (const yaw of [-100, -45, 0, 45, 100]) {
      const p = portraitCameraPose(frame, yaw, close),
        direction = p.position.clone().sub(p.target);
      assert.ok(
        Math.abs(direction.dot(frame.up)) < 1e-12,
        "camera must not look down along face axis",
      );
      assert.ok(Math.abs(direction.length() - (close ? 0.58 : 0.95)) < 1e-12);
      assert.deepEqual(p.target, frame.center);
    }
});

test("studio camera adjustments cannot mutate shared facial landmarks", () => {
 const frame={center:new Vector3(0,1.6,0),up:new Vector3(0,1,0),forward:new Vector3(0,0,1)};
 const pose=portraitCameraPose(frame,30,false);pose.target.y-=.88;pose.up.set(1,0,0);
 assert.deepEqual(frame.center.toArray(),[0,1.6,0]);assert.deepEqual(frame.up.toArray(),[0,1,0]);
});

// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import { IdleDirector } from "./idle-behavior.ts";
test("idle allocation gives the first three standing operators different behaviors", () => {
  const d = new IdleDirector(() => 0.4);
  const clips = Array.from({ length: 3 }, () => d.next("open").clip);
  assert.equal(new Set(clips).size, 3);
});
test("idle scheduling never repeats immediately and respects stance", () => {
  const d = new IdleDirector(() => 0.2);
  for (const context of ["open", "cover", "pistol"] as const) {
    let previous = "";
    for (let i = 0; i < 30; i++) {
      const next = d.next(context, previous);
      assert.notEqual(next.clip, previous);
      if (context === "pistol") assert.ok(next.clip.startsWith("pistol"));
      if (context === "cover") assert.match(next.clip, /crouch|covered/);
      if (context === "open")
        assert.doesNotMatch(next.clip, /crouch|covered|pistol/);
      assert.ok(next.seconds >= 2.5 && next.seconds <= 10);
      previous = next.clip;
    }
  }
});

test('low cover never cycles into a standing shot or wall pose',()=>{
 const d=new IdleDirector(()=>.7);
 for(let i=0;i<100;i++)assert(['crouch_idle','rifle_crouch_idle'].includes(d.next('cover').clip));
});

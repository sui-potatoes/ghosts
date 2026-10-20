// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  effectVolume,
  isRecorded,
  lineUrl,
  pickPhrase,
  PHRASES,
  voiceKey,
  voiceVolume,
} from "./voice.ts";

test("line files are named phrase, sex and two-digit voice index", () => {
  assert.equal(voiceKey({ sex: "male", index: 1 }), "male-01");
  assert.equal(lineUrl("frag-out", { sex: "female", index: 12 }), "/sounds/frag-out-female-12.mp3");
  assert.ok(isRecorded({ sex: "male", index: 1 }));
  assert.ok(isRecorded({ sex: "female", index: 1 }));
  assert.ok(!isRecorded({ sex: "male", index: 2 }));
});

test("phrases avoid an immediate repeat when the event has a choice", () => {
  for (let i = 0; i < 20; i++) assert.notEqual(pickPhrase("grenade", "frag-out"), "frag-out");
  assert.equal(pickPhrase("fire", "taking-the-shot"), "taking-the-shot");
  assert.equal(pickPhrase("cover", null), "taking-cover");
  assert.equal(pickPhrase("select", null, () => 0), PHRASES.select[0]);
  assert.equal(pickPhrase("select", null, () => 0.999), PHRASES.select[1]);
});

test("levels multiply master by the channel, and mute silences both", () => {
  const levels = { muted: false, master: 80, sfx: 80, voice: 80 };
  const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9);
  near(effectVolume(levels), 0.64);
  near(voiceVolume(levels), 0.64);
  near(effectVolume({ ...levels, muted: true }), 0);
  near(voiceVolume({ ...levels, muted: true }), 0);
  near(effectVolume({ ...levels, master: 50, sfx: 100 }), 0.5);
  near(voiceVolume({ ...levels, master: 50, voice: 20 }), 0.1);
});

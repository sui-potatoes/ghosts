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
  VoicePlayer,
} from "./voice.ts";

test("line files are named phrase, sex and two-digit voice index", () => {
  assert.equal(voiceKey({ sex: "male", index: 1 }), "male-01");
  assert.equal(lineUrl("frag-out", { sex: "female", index: 12 }), "/sounds/frag-out-female-12.mp3");
  assert.ok(isRecorded({ sex: "male", index: 1 }));
  assert.ok(isRecorded({ sex: "female", index: 1 }));
  assert.ok(!isRecorded({ sex: "male", index: 2 }));
});

test("voice loading cannot revive an interrupted line; pause and disposal control the radio channel", async (t) => {
  const contexts: FakeContext[] = [];
  const starts: unknown[] = [];
  const pending: (() => void)[] = [];
  const node = () => ({
    connect(next: unknown) { return next; }, disconnect() {}, stop() {},
    start() { starts.push(this); },
    frequency: { value: 0 }, gain: { value: 0 }, threshold: { value: 0 }, knee: { value: 0 },
    ratio: { value: 0 }, attack: { value: 0 }, release: { value: 0 },
  });
  class FakeContext {
    state = "suspended";
    destination = node();
    constructor() { contexts.push(this); }
    createBiquadFilter = node;
    createGain = node;
    createDynamicsCompressor = node;
    createWaveShaper = node;
    createBufferSource = node;
    decodeAudioData() { return Promise.resolve({}); }
    resume() { this.state = "running"; return Promise.resolve(); }
    suspend() { this.state = "suspended"; return Promise.resolve(); }
    close() { this.state = "closed"; return Promise.resolve(); }
  }
  const originals = ["AudioContext", "document", "fetch"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  t.after(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  Object.defineProperty(globalThis, "AudioContext", { configurable: true, value: FakeContext });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { body: { dataset: {} } } });
  t.mock.method(globalThis, "fetch", () => new Promise((resolve) => {
    pending.push(() => resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) } as Response));
  }));
  const player = new VoicePlayer(() => 1);
  const voice = { sex: "male", index: 1 } as const;
  player.speak("fire", voice);
  player.speak("cover", voice);
  pending[0]();
  await new Promise(setImmediate);
  assert.equal(starts.length, 0, "superseded fetch stays silent");
  player.setPaused(true);
  pending[1]();
  await new Promise(setImmediate);
  assert.equal(starts.length, 1);
  assert.equal(contexts[0].state, "suspended", "loaded line remains on the paused timeline");
  player.setPaused(false);
  assert.equal(contexts[0].state, "running");
  player.speak("hit", voice);
  player.dispose();
  pending[2]();
  await new Promise(setImmediate);
  assert.equal(starts.length, 1, "teardown cancels unfinished playback");
  assert.equal(contexts[0].state, "closed");
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

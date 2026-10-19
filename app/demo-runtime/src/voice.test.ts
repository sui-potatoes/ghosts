import { test } from "node:test";
import assert from "node:assert/strict";
import {
  effectVolume,
  isRecorded,
  lineUrl,
  pickPhrase,
  PHRASES,
  readAudioSettings,
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

test("levels follow the shell's saved audio settings", () => {
  const near = (fn: typeof effectVolume, raw: string | null, expected: number) =>
    assert.ok(Math.abs(fn(readAudioSettings(raw)) - expected) < 1e-9, `${fn.name} ${raw}`);
  near(effectVolume, null, 0.64);
  near(voiceVolume, null, 0.64);
  near(effectVolume, '{"audio":{"muted":true}}', 0);
  near(voiceVolume, '{"audio":{"muted":true}}', 0);
  near(effectVolume, '{"audio":{"master":50,"sfx":100}}', 0.5);
  near(voiceVolume, '{"audio":{"master":50,"sfx":100,"voice":20}}', 0.1);
  near(effectVolume, '{"audio":{"master":50,"voice":20}}', 0.4);
  near(voiceVolume, '{"audio":{"master":"loud"}}', 0.64);
  near(effectVolume, "not json", 0.64);
});

// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { test } from "node:test";

import { jitter, JITTER, panFor, PAN_MAX, pitchFor, RateGate } from "../src/audio/ui-model.ts";
import { hapticDevice, hapticPlan } from "../src/haptics/model.ts";
import { parentOf } from "../src/routes.ts";
import { FocusStore, type Command, type FocusElement } from "../src/ui/focus-store.ts";
import {
    COUNTER_MAX_MS,
    COUNTER_MAX_STEPS,
    counterSteps,
    DETENT_OVERSHOOT_PX,
    DETENT_PEAK,
    detentFrames,
    HOLD_MS,
    HOLD_STEPS,
    HoldMachine,
    holdRate,
    navMotion,
    overshoot,
    sameBox,
} from "../src/ui/tactile-model.ts";

// === Detent =================================================================

test("the cursor overshoots along its travel, a fixed small amount, then lands exactly", () => {
    const from = { x: 10, y: 100, w: 300, h: 40 };
    const to = { x: 10, y: 140, w: 300, h: 40 };
    const frames = detentFrames(from, to);
    assert.equal(frames.length, 3);
    assert.deepEqual(
        frames.map((f) => f.offset),
        [0, DETENT_PEAK, 1],
    );
    const peak = frames[1];
    assert.ok(peak.y > to.y, "runs past the target moving down");
    assert.ok(peak.y - to.y <= DETENT_OVERSHOOT_PX);
    assert.equal(peak.x, to.x, "no sideways overshoot on a vertical move");
    assert.equal(peak.w, to.w);
    assert.deepEqual({ x: frames[2].x, y: frames[2].y, w: frames[2].w, h: frames[2].h }, to);
});

test("overshoot is capped for long jumps, proportional for short hops, signed", () => {
    assert.equal(overshoot(600), DETENT_OVERSHOOT_PX);
    assert.equal(overshoot(-600), -DETENT_OVERSHOOT_PX);
    assert.ok(Math.abs(overshoot(10) - 0.6) < 1e-9);
    assert.equal(overshoot(0), 0);
});

test("reduced motion is a cut: no frames", () => {
    const a = { x: 0, y: 0, w: 10, h: 10 };
    assert.deepEqual(detentFrames(a, { ...a, y: 50 }, true), []);
});

test("sameBox ignores sub-pixel re-measures", () => {
    const a = { x: 0, y: 0, w: 10, h: 10 };
    assert.ok(sameBox(a, { x: 0.2, y: -0.3, w: 10.1, h: 10 }));
    assert.ok(!sameBox(a, { x: 0, y: 2, w: 10, h: 10 }));
});

// === Hold ===================================================================

test("a hold completes at HOLD_MS while still held, stepping up on the way", () => {
    const hold = new HoldMachine();
    assert.equal(hold.begin("reset", 0), true);
    assert.equal(hold.holding, "reset");
    const early = hold.frame(HOLD_MS / 2);
    assert.equal(early.done, false);
    assert.ok(Math.abs(early.progress - 0.5) < 1e-9);
    assert.equal(early.step, HOLD_STEPS / 2);
    assert.equal(early.stepped, true);
    assert.equal(hold.frame(HOLD_MS / 2 + 1).stepped, false, "a step ticks once");
    const end = hold.frame(HOLD_MS);
    assert.equal(end.done, true);
    assert.equal(end.progress, 1);
    assert.equal(hold.active, false, "done clears it");
    assert.equal(hold.release(), "idle");
});

test("releasing early cancels; a repeat press while holding is ignored", () => {
    const hold = new HoldMachine();
    hold.begin("dismiss", 100);
    assert.equal(hold.begin("dismiss", 150), false, "key auto-repeat does not restart");
    assert.equal(hold.frame(400).done, false);
    assert.equal(hold.release(), "cancelled");
    assert.equal(hold.active, false);
    assert.equal(hold.frame(5000).done, false, "nothing completes after a release");
    assert.equal(hold.begin("dismiss", 6000), true, "a fresh press starts over");
});

test("the hold's tick rises a fifth over its steps", () => {
    assert.ok(holdRate(HOLD_STEPS) > holdRate(0));
    assert.ok(Math.abs(holdRate(HOLD_STEPS) / holdRate(0) - 2 ** (7 / 12)) < 1e-9);
    for (let s = 1; s <= HOLD_STEPS; s++) assert.ok(holdRate(s) > holdRate(s - 1));
});

function holdStore() {
    const calls: string[] = [];
    const s = new FocusStore(
        { action: "back", label: "Leave" },
        {
            confirm: () => calls.push("confirm"),
            hold: (_el, step) => calls.push(`hold${step}`),
            holdCancel: () => calls.push("cancel"),
        },
    );
    const el = {
        isConnected: true,
        getBoundingClientRect: () =>
            ({ left: 0, top: 0, width: 100, height: 40, right: 100, bottom: 40 }) as DOMRect,
        compareDocumentPosition: () => 4,
    } as unknown as FocusElement;
    let ran = 0;
    const commands: Command[] = [
        { action: "confirm", label: "Reset", hold: true, run: () => void ran++ },
    ];
    s.register({ id: "prompt", group: "prompt", scope: "root", el, commands });
    return { s, calls, ran: () => ran, confirm: commands[0] };
}

test("a held confirm runs once at the end of the hold, with rising ticks", () => {
    const { s, calls, ran, confirm } = holdStore();
    s.run(confirm, "prompt", 0);
    assert.equal(ran(), 0, "a press only starts the hold");
    assert.equal(s.hold?.id, "prompt");
    s.run(confirm, "prompt", 50); // key auto-repeat
    assert.equal(s.holdFrame(HOLD_MS / 2), 0.5);
    assert.equal(ran(), 0);
    assert.equal(s.holdFrame(HOLD_MS), 1);
    assert.equal(ran(), 1);
    assert.equal(s.hold, null);
    assert.equal(s.holdFrame(HOLD_MS + 100), null);
    assert.equal(ran(), 1, "never twice");
    assert.deepEqual(calls, ["hold0", `hold${HOLD_STEPS / 2}`, "confirm"]);
    assert.equal(s.pulse?.kind, "press");
    s.run(confirm, "prompt", HOLD_MS + 50); // the key still down, auto-repeating
    assert.equal(s.hold, null, "a completed press starts nothing until let go");
    s.releaseHold();
    s.run(confirm, "prompt", HOLD_MS + 200);
    assert.equal(s.hold?.id, "prompt", "a fresh press holds again");
});

test("letting go early cancels the held confirm; Back lets go too", () => {
    const { s, calls, ran, confirm } = holdStore();
    s.run(confirm, "prompt", 0);
    s.holdFrame(300);
    s.releaseHold();
    assert.equal(s.hold, null);
    assert.equal(s.holdFrame(2000), null);
    assert.equal(ran(), 0);
    assert.ok(calls.includes("cancel"));
    s.run(confirm, "prompt", 3000);
    assert.equal(s.invoke("back"), true);
    assert.equal(s.hold, null);
    assert.equal(ran(), 0);
});

// === Counters ===============================================================

test("a counter rolls in whole steps, eased, ending exactly on the value, within the cap", () => {
    const steps = counterSteps(1000, 1450);
    assert.ok(steps.length <= COUNTER_MAX_STEPS);
    assert.equal(steps[steps.length - 1].value, 1450);
    assert.ok(steps[steps.length - 1].at <= COUNTER_MAX_MS);
    for (let i = 1; i < steps.length; i++) {
        assert.ok(steps[i].value > steps[i - 1].value, "monotonic");
        assert.ok(steps[i].at > steps[i - 1].at);
        assert.equal(Number.isInteger(steps[i].value), true);
    }
    // Eased out: the first jump is the biggest.
    const first = steps[0].value - 1000;
    const last = steps[steps.length - 1].value - steps[steps.length - 2].value;
    assert.ok(first > last);
});

test("small changes click once per unit, falling values roll down, no change is silent", () => {
    assert.deepEqual(
        counterSteps(3, 5).map((s) => s.value),
        [4, 5],
    );
    assert.deepEqual(
        counterSteps(5, 3).map((s) => s.value),
        [4, 3],
    );
    assert.deepEqual(counterSteps(7, 7), []);
    assert.deepEqual(counterSteps(Number.NaN, 7), []);
});

// === Screen motion ==========================================================

test("going up a level is back, anything else is in, sibling sections do not move", () => {
    assert.equal(navMotion(null, "/", parentOf), null);
    assert.equal(navMotion("/", "/settings", parentOf), "in");
    assert.equal(navMotion("/settings", "/", parentOf), "back");
    assert.equal(navMotion("/play", "/play/ranked", parentOf), "in");
    assert.equal(navMotion("/play/ranked", "/play", parentOf), "back");
    assert.equal(navMotion("/play/ranked", "/", parentOf), "back");
    assert.equal(navMotion("/watch/0x1", "/watch", parentOf), "back");
    assert.equal(navMotion("/headquarters", "/headquarters/armory", parentOf), null);
    assert.equal(navMotion("/headquarters/armory", "/headquarters", parentOf), null);
    assert.equal(navMotion("/settings", "/settings", parentOf), null);
});

// === Sound ==================================================================

test("pan follows the row across the screen, within PAN_MAX", () => {
    assert.equal(panFor(0, 1000), -PAN_MAX);
    assert.equal(panFor(500, 1000), 0);
    assert.equal(panFor(1000, 1000), PAN_MAX);
    assert.equal(panFor(5000, 1000), PAN_MAX);
    assert.equal(panFor(10, 0), 0);
});

test("pitch falls four semitones from the top of the screen to the bottom", () => {
    assert.ok(Math.abs(pitchFor(0, 800) - 2 ** (2 / 12)) < 1e-9);
    assert.equal(pitchFor(400, 800), 1);
    assert.ok(Math.abs(pitchFor(800, 800) - 2 ** (-2 / 12)) < 1e-9);
});

test("jitter stays within ±JITTER of the rate", () => {
    assert.ok(Math.abs(jitter(1, () => 0) - (1 - JITTER)) < 1e-9);
    assert.ok(Math.abs(jitter(1, () => 1) - (1 + JITTER)) < 1e-9);
    assert.equal(
        jitter(0.6, () => 0.5),
        0.6,
    );
});

test("the rate gate drops what comes too soon, not queues it", () => {
    const gate = new RateGate(30);
    assert.equal(gate.take(0), true);
    assert.equal(gate.take(10), false);
    assert.equal(gate.take(29), false);
    assert.equal(gate.take(30), true);
    assert.equal(gate.take(31), false);
});

// === Haptics ================================================================

test("a pad feels every gesture; the refusal is a double pulse; confirm outweighs move", () => {
    const move = hapticPlan("move", "pad");
    const confirm = hapticPlan("confirm", "pad");
    const deny = hapticPlan("deny", "pad");
    assert.ok(move && "rumble" in move && confirm && "rumble" in confirm);
    assert.ok(deny && "rumble" in deny);
    assert.equal(deny.rumble.length, 2);
    assert.ok(deny.rumble[1].delay > deny.rumble[0].duration, "two distinct pulses");
    const weight = (r: { strong: number; weak: number; duration: number }) =>
        (r.strong + r.weak) * r.duration;
    assert.ok(weight(confirm.rumble[0]) > weight(move.rumble[0]));
});

test("a phone never buzzes on a move or a back, buzzes on confirm and twice on refusal", () => {
    assert.equal(hapticPlan("move", "touch"), null);
    assert.equal(hapticPlan("back", "touch"), null);
    assert.deepEqual(hapticPlan("confirm", "touch"), { vibrate: [12] });
    const deny = hapticPlan("deny", "touch");
    assert.ok(deny && "vibrate" in deny);
    assert.equal(deny.vibrate.length, 3, "buzz, gap, buzz");
});

test("keyboard and mouse feel nothing; the hold's rumble grows with its progress", () => {
    for (const g of ["move", "confirm", "deny", "back", "hold"] as const)
        assert.equal(hapticPlan(g, "none"), null);
    assert.equal(hapticDevice("gamepad"), "pad");
    assert.equal(hapticDevice("touch"), "touch");
    assert.equal(hapticDevice("mouse"), "none");
    assert.equal(hapticDevice("keyboard"), "none");
    const low = hapticPlan("hold", "pad", 0.1);
    const high = hapticPlan("hold", "pad", 0.9);
    assert.ok(low && "rumble" in low && high && "rumble" in high);
    assert.ok(high.rumble[0].strong > low.rumble[0].strong);
});

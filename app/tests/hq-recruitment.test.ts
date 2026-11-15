// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { test } from "node:test";

import {
    advance,
    beatBefore,
    cuesBetween,
    FIRST_BEAT,
    litOf,
    namedOf,
    nextStep,
    NEXT_BEAT,
    PLATE_BEAT,
    phaseOf,
    settle,
    standing,
    type Slots,
    type Stages,
} from "../src/features/headquarters/squad/recruit-reveal.ts";

const r = (id: string) => ({ objectId: id });
const four: Slots = [r("a"), r("b"), r("c"), r("d")];
const empty: Slots = [null, null, null, null];

/** Run the reveal to its end, one step at a time. */
function run(slots: Slots, from: Stages): Stages[] {
    const trail = [from];
    for (let s = from; nextStep(slots, s);) trail.push((s = advance(slots, s)));
    return trail;
}

test("four dark podiums wait: nothing is lit or named, the hire is on offer", () => {
    assert.deepEqual(litOf(empty, {}), [false, false, false, false]);
    assert.deepEqual(namedOf(empty, {}), [false, false, false, false]);
    assert.equal(phaseOf(empty, {}, false), "idle");
    assert.equal(phaseOf(empty, {}, true), "waiting");
});

test("hired recruits come up left to right, a light then its plate, one podium at a time", () => {
    const trail = run(four, {});
    assert.equal(trail.length, 9); // eight steps
    const lit = trail.map((s) => litOf(four, s).filter(Boolean).length);
    const named = trail.map((s) => namedOf(four, s).filter(Boolean).length);
    assert.deepEqual(lit, [0, 1, 1, 2, 2, 3, 3, 4, 4]);
    assert.deepEqual(named, [0, 0, 1, 1, 2, 2, 3, 3, 4]);
    // Left to right: the lit podiums are always a prefix.
    for (const s of trail) {
        const flags = litOf(four, s);
        assert.deepEqual(
            flags,
            [...flags].sort((x, y) => Number(y) - Number(x)),
        );
    }
});

test("a plate is never named before its light, and only one podium is mid-reveal", () => {
    for (const s of run(four, {})) {
        const l = litOf(four, s);
        const n = namedOf(four, s);
        assert.ok(n.every((on, i) => !on || l[i]));
        assert.ok(l.filter((on, i) => on && !n[i]).length <= 1);
    }
});

test("phases: revealing while steps remain, settled once four stand", () => {
    const trail = run(four, {});
    assert.equal(phaseOf(four, trail[0], true), "revealing");
    assert.equal(phaseOf(four, trail[4], false), "revealing");
    assert.equal(phaseOf(four, trail[8], false), "settled");
    assert.equal(phaseOf(four, trail[8], true), "settled");
});

test("skip settles at once, from anywhere, and is idempotent", () => {
    const mid = run(four, {})[3];
    const done = settle(four, mid);
    assert.equal(nextStep(four, done), null);
    assert.deepEqual(namedOf(four, done), [true, true, true, true]);
    assert.equal(settle(four, done), done);
    assert.equal(phaseOf(four, done, false), "settled");
});

test("reduced motion reads as settled: the same settle, no steps", () => {
    assert.deepEqual(namedOf(four, settle(four, {})), [true, true, true, true]);
});

test("a squad on file at the start stands complete and shows no reveal", () => {
    const s = standing(four);
    assert.equal(nextStep(four, s), null);
    assert.equal(phaseOf(four, s, false), "settled");
});

test("partial squad: recruits on file stand lit, only the new ones are revealed, in slot order", () => {
    const before: Slots = [r("a"), null, r("c"), null];
    const stages = standing(before); // a and c stand
    const after: Slots = [r("a"), r("b"), r("c"), r("d")];
    assert.equal(phaseOf(before, stages, true), "waiting"); // hire under way, nothing landed
    assert.deepEqual(litOf(after, stages), [true, false, true, false]);
    const trail = run(after, stages);
    assert.equal(trail.length, 5); // two new recruits, two steps each
    assert.deepEqual(litOf(after, trail[1]), [true, true, true, false]);
    assert.deepEqual(namedOf(after, trail[2]), [true, true, true, false]);
    assert.deepEqual(namedOf(after, trail[4]), [true, true, true, true]);
    assert.equal(phaseOf(after, trail[4], false), "settled");
});

test("a partial squad with no hire under way offers the hire, not Continue", () => {
    const part: Slots = [r("a"), r("b"), null, null];
    assert.equal(phaseOf(part, standing(part), false), "idle");
});

test("recruits landing in two batches still reveal in order from where it stood", () => {
    const first: Slots = [r("a"), r("b"), null, null];
    let s = settle(first, {});
    assert.equal(phaseOf(first, s, true), "waiting");
    const second: Slots = [r("a"), r("b"), r("c"), r("d")];
    assert.deepEqual(nextStep(second, s), { id: "c", index: 2, to: 1 });
    s = advance(second, s);
    assert.deepEqual(litOf(second, s), [true, true, true, false]);
});

test("beats: a plate follows its light quickly, the next light after a pause", () => {
    assert.equal(beatBefore({ to: 2 }, false), PLATE_BEAT);
    assert.equal(beatBefore({ to: 1 }, true), FIRST_BEAT);
    assert.equal(beatBefore({ to: 1 }, false), NEXT_BEAT);
});

test("unlit until revealed: a podium's light comes with its recruit, never before", () => {
    for (const s of run(four, {})) {
        const lit = litOf(four, s);
        const named = namedOf(four, s);
        lit.forEach((on, i) => assert.ok(on || !named[i]));
    }
    assert.deepEqual(litOf(four, {}), [false, false, false, false]);
});

test("one switch-on cue per reveal, in podium order, the last one marked", () => {
    const trail = run(four, {});
    const cues = trail.flatMap((s, i) => (i ? cuesBetween(four, trail[i - 1], s) : []));
    assert.deepEqual(cues, [
        { index: 0, last: false },
        { index: 1, last: false },
        { index: 2, last: false },
        { index: 3, last: true },
    ]);
});

test("a plate step makes no cue", () => {
    const trail = run(four, {});
    assert.deepEqual(cuesBetween(four, trail[1], trail[2]), []);
});

test("a skip sounds at most one settle cue, however many lights come on", () => {
    const mid = run(four, {})[3];
    const cues = cuesBetween(four, mid, settle(four, mid), true);
    assert.equal(cues.length, 1);
    assert.deepEqual(cues[0], { index: 3, last: true });
    assert.equal(cuesBetween(four, {}, settle(four, {}), true).length, 1);
    assert.deepEqual(cuesBetween(four, standing(four), settle(four, standing(four)), true), []);
});

test("a partial squad cues only the new podiums, the last of them marked", () => {
    const after: Slots = [r("a"), r("b"), r("c"), r("d")];
    const stages = { a: 2, c: 2 } as Stages;
    const trail = run(after, stages);
    const cues = trail.flatMap((s, i) => (i ? cuesBetween(after, trail[i - 1], s) : []));
    assert.deepEqual(cues, [
        { index: 1, last: false },
        { index: 3, last: true },
    ]);
});

// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import type { GameEvent } from "../events.ts";
import { blackRain } from "../scenario.ts";
import { beatSeconds, Playback, type PlaybackStage } from "./playback.ts";
import type { RecordSource } from "./timeline.ts";

const move = (unit: string): GameEvent => ({ type: "move", unit, path: [[0, 0], [0, 1]], vault: false, cover: false });

/** Three turns: side 0 (events 0–1), side 1 (2–4), side 0 (5–6). */
const GAME: GameEvent[] = [
  move("a"),
  { type: "hostile-phase" },
  move("h"),
  { type: "shot", unit: "h", target: "a", hit: true, crit: false, damage: 12, killed: true, reaction: false },
  { type: "turn", turn: 2 },
  move("b"),
  move("c"),
];

/** A source that grows when told to; complete once `end` is called. */
function growing(initial: GameEvent[], done = false) {
  const events = [...initial];
  let ended = done;
  const listeners = new Set<() => void>();
  const source: RecordSource = {
    scenario: blackRain,
    sides: [{ name: "Ghosts" }, { name: "Hostiles" }],
    events: () => events,
    ended: () => ended,
    subscribe: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
  };
  return {
    source,
    push(...more: GameEvent[]) {
      events.push(...more);
      for (const fn of listeners) fn();
    },
    end() {
      ended = true;
      for (const fn of listeners) fn();
    },
  };
}

/** A stage whose animations last until the test lets them go (`release`), or no time at all (`instant`). */
function stage({ instant = false, manualWait = false, reduced = false } = {}) {
  const log: string[] = [];
  let pending: (() => void)[] = [];
  const s = {
    log,
    scale: 1,
    voice: true,
    presented: [] as GameEvent[],
    /** Let every animation going now finish. */
    release() {
      const now = pending;
      pending = [];
      for (const go of now) go();
    },
    /** The pauses asked for (in scene seconds) and the ones still running. */
    waits: [] as number[],
    pendingWaits: [] as (() => void)[],
    /** Let the pauses going now run out. */
    endWaits() {
      const now = s.pendingWaits;
      s.pendingWaits = [];
      for (const go of now) go();
    },
    get animating() {
      return pending.length;
    },
    stage: {
      rebuild(_events, index) {
        log.push(`rebuild ${index}`);
      },
      present(event) {
        s.presented.push(event);
        log.push(`present ${event.type}`);
        if (instant) return Promise.resolve();
        return new Promise<void>((resolve) => pending.push(resolve));
      },
      wait(seconds) {
        s.waits.push(seconds);
        if (!manualWait) return Promise.resolve();
        return new Promise<void>((resolve) => s.pendingWaits.push(resolve));
      },
      reduced: () => reduced,
      async finish(done) {
        log.push("finish");
        s.release();
        s.endWaits();
        await done;
      },
      setTimeScale(scale) {
        s.scale = scale;
      },
      setVoice(on) {
        s.voice = on;
      },
    } satisfies PlaybackStage,
  };
  return s;
}

/** Let promise chains run. */
const tick = async (n = 10) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};

test("a replay plays every event in order from the start and stops at the end, finished", async () => {
  const st = stage({ instant: true });
  const pb = new Playback(growing(GAME, true).source, st.stage);
  pb.start();
  await tick(40);
  assert.deepEqual(st.log[0], "rebuild 0");
  assert.deepEqual(st.presented, GAME);
  const state = pb.getState();
  assert.equal(state.cursor, GAME.length);
  assert.equal(state.playing, false);
  assert.equal(state.finished, true);
  assert.equal(state.live, false);
  assert.equal(st.scale, 0, "the field holds at the end");
  // Play at the end starts over.
  pb.play();
  await tick(40);
  assert.equal(st.log.filter((l) => l === "rebuild 0").length, 2);
  assert.equal(st.presented.length, GAME.length * 2);
});

test("pause holds the animation where it is (time scale 0) and play goes on from it", async () => {
  const st = stage();
  const pb = new Playback(growing(GAME, true).source, st.stage);
  pb.start();
  await tick();
  assert.equal(st.presented.length, 1);
  assert.equal(st.scale, 1);
  pb.pause();
  assert.equal(st.scale, 0);
  assert.equal(pb.getState().playing, false);
  st.release();
  await tick();
  assert.equal(st.presented.length, 1, "nothing new starts while paused");
  pb.play();
  assert.equal(st.scale, 1);
  await tick();
  assert.equal(st.presented.length, 2, "the next event follows on play");
  assert.equal(pb.getState().cursor, 2);
});

test("speeds: 0.5, 1, 2 and 4 set the scene clock, the voice is off above 1x, a change applies mid-animation", async () => {
  const st = stage();
  const pb = new Playback(growing(GAME, true).source, st.stage);
  pb.start();
  await tick();
  pb.setSpeed(2);
  assert.equal(st.scale, 2);
  assert.equal(st.voice, false);
  pb.stepSpeed(1);
  assert.equal(pb.getState().speed, 4);
  pb.stepSpeed(1);
  assert.equal(pb.getState().speed, 4, "stops at 4x");
  pb.setSpeed(0.5);
  assert.equal(st.scale, 0.5);
  assert.equal(st.voice, true);
  pb.stepSpeed(-1);
  assert.equal(pb.getState().speed, 0.5, "stops at 0.5x");
  pb.pause();
  assert.equal(st.scale, 0);
  pb.setSpeed(2);
  assert.equal(st.scale, 0, "a paused field stays held at any speed");
  pb.play();
  assert.equal(st.scale, 2);
  assert.equal(st.presented.length, 1, "all of that within one animation");
});

test("next, previous and jump rebuild at turn starts; mid-animation the animation is finished first", async () => {
  const st = stage();
  const pb = new Playback(growing(GAME, true).source, st.stage);
  pb.start({ paused: true });
  await tick();
  assert.deepEqual(pb.getState().turns.map((t) => t.start), [0, 2, 5]);
  pb.nextTurn();
  await tick();
  assert.equal(st.log.at(-1), "rebuild 2");
  assert.equal(pb.getState().turn, 1);
  pb.nextTurn();
  await tick();
  assert.equal(st.log.at(-1), "rebuild 5");
  pb.prevTurn();
  await tick();
  assert.equal(st.log.at(-1), "rebuild 2");
  pb.jump(2);
  await tick();
  assert.equal(st.log.at(-1), "rebuild 5");
  pb.jump(0);
  await tick();
  assert.equal(st.log.at(-1), "rebuild 0");
  pb.prevTurn();
  await tick();
  assert.equal(st.log.at(-1), "rebuild 0", "before the first turn there is only the first turn");
  // Playing: the shot (event 3) is mid-animation when the viewer steps back.
  pb.jump(1);
  await tick();
  pb.play();
  await tick();
  st.release();
  await tick();
  assert.equal(st.presented.at(-1)?.type, "shot");
  assert.equal(st.animating, 1);
  pb.pause();
  pb.prevTurn();
  await tick();
  assert.deepEqual(st.log.slice(-2), ["finish", "rebuild 0"]);
  assert.equal(st.animating, 0, "the shot was run to its end before the rebuild");
  assert.equal(pb.getState().cursor, 0);
  // Next past the last turn goes to the end: finished.
  pb.jump(2);
  await tick();
  pb.nextTurn();
  await tick();
  assert.equal(st.log.at(-1), `rebuild ${GAME.length}`);
  assert.equal(pb.getState().finished, true);
  const before = st.log.length;
  pb.restart();
  await tick();
  assert.equal(st.log.slice(before).find((l) => l.startsWith("rebuild")), "rebuild 0");
  assert.equal(pb.getState().playing, true);
  pb.dispose();
});

test("live: follows new events at the edge; pause and stepping back leave it; Live returns at 1x; the end finishes", async () => {
  const st = stage({ instant: true });
  const game = growing(GAME.slice(0, 5));
  const pb = new Playback(game.source, st.stage);
  pb.start({ at: "live" });
  await tick();
  assert.equal(st.log[0], "rebuild 5");
  let state = pb.getState();
  assert.equal(state.live, true, "at the edge and playing");
  assert.equal(state.growing, true);
  game.push(GAME[5]);
  await tick();
  assert.equal(st.presented.at(-1), GAME[5], "a new event plays as it arrives");
  assert.equal(pb.getState().live, true);
  pb.pause();
  assert.equal(pb.getState().live, false, "pausing leaves Live");
  pb.play();
  assert.equal(pb.getState().live, true, "playing at the edge is Live again");
  pb.setSpeed(4);
  pb.pause();
  pb.prevTurn();
  await tick();
  pb.prevTurn();
  await tick();
  state = pb.getState();
  assert.equal(state.live, false, "stepping back leaves Live");
  assert.equal(state.behind, 2, "two turns behind the newest");
  game.push(GAME[6]);
  await tick();
  assert.equal(pb.getState().total, GAME.length, "the match grows behind the viewer");
  pb.goLive();
  await tick();
  state = pb.getState();
  assert.equal(st.log.at(-1), `rebuild ${GAME.length}`);
  assert.equal(state.speed, 1, "Live is 1x");
  assert.equal(state.live, true);
  assert.equal(state.behind, 0);
  game.end();
  await tick();
  state = pb.getState();
  assert.equal(state.finished, true);
  assert.equal(state.live, false);
  assert.equal(state.playing, false);
});

test("a paused viewer behind a live game catches up when played, then follows", async () => {
  const st = stage({ instant: true });
  const game = growing(GAME.slice(0, 2));
  const pb = new Playback(game.source, st.stage);
  pb.start({ paused: true });
  await tick();
  assert.equal(pb.getState().live, false);
  pb.play();
  await tick();
  assert.equal(pb.getState().cursor, 2);
  assert.equal(pb.getState().live, true);
  game.push(...GAME.slice(2));
  await tick(40);
  assert.equal(pb.getState().cursor, GAME.length);
  pb.dispose();
  game.push(move("z"));
  await tick();
  assert.equal(st.presented.length, GAME.length, "a disposed playback plays nothing more");
});

test("Live holds while a new event plays: arriving events never flicker the viewer out of it", async () => {
  const st = stage();
  const game = growing(GAME.slice(0, 2));
  const pb = new Playback(game.source, st.stage);
  pb.start({ at: "live" });
  await tick();
  assert.equal(pb.getState().live, true);
  game.push(GAME[2]);
  await tick();
  assert.equal(st.animating, 1, "the new event is playing");
  game.push(GAME[3]);
  assert.equal(pb.getState().cursor, 3);
  assert.equal(pb.getState().live, true, "one event behind the newest, still following");
  st.release();
  await tick();
  st.release();
  await tick();
  assert.equal(pb.getState().live, true);
  pb.jump(0);
  await tick();
  pb.play();
  assert.equal(pb.getState().live, false, "playing from the past is not following");
  pb.dispose();
});

test("the outcome at the end: the field's winner first, else the source's word", async () => {
  const st = stage({ instant: true });
  const done = growing(GAME, true);
  done.source.outcome = () => ({ winner: null, reason: "Forfeit" });
  const pb = new Playback(done.source, { ...st.stage, outcome: () => null });
  pb.start();
  await tick(40);
  assert.deepEqual(pb.getState().outcome, { winner: null, reason: "Forfeit" });
  const won = new Playback(done.source, { ...st.stage, outcome: () => ({ winner: 1 }) });
  won.start();
  await tick(40);
  assert.deepEqual(won.getState().outcome, { winner: 1 });
  assert.equal(new Playback(growing(GAME).source, st.stage).getState().outcome, null, "none before the end");
});

/** The last event of GAME, then the end of the game, in a source that was open until now. */
const LAST = GAME.length - 1;

test("the result waits for the last animation and the beat, not for the last event to start", async () => {
  const st = stage({ manualWait: true });
  const pb = new Playback(growing(GAME.slice(0, LAST + 1), true).source, st.stage);
  pb.start();
  await tick();
  // Play up to the last event.
  for (let i = 0; i < 40 && pb.getState().cursor < GAME.length; i++) {
    st.release();
    st.endWaits();
    await tick();
  }
  assert.equal(pb.getState().cursor, GAME.length, "the last event has started");
  assert.equal(pb.getState().finished, false, "not finished while its animation runs");
  assert.equal(pb.getState().playing, true, "the transport still plays");
  assert.equal(pb.getState().outcome, null);
  st.release();
  await tick();
  assert.equal(pb.getState().finished, false, "the animation is done, the beat is not");
  assert.equal(st.waits.at(-1), beatSeconds(1, false));
  assert.equal(st.pendingWaits.length, 1, "the beat is a pause on the scene clock");
  st.endWaits();
  await tick();
  assert.equal(pb.getState().finished, true);
  assert.equal(pb.getState().playing, false);
  pb.dispose();
});

test("the beat replaces the gap after the last event, and follows speed with a real-time floor", () => {
  assert.equal(beatSeconds(1, false), 0.9);
  assert.equal(beatSeconds(0.5, false), 0.9);
  assert.equal(beatSeconds(2, false), 0.9);
  assert.ok(Math.abs(beatSeconds(4, false) / 4 - 0.3) < 1e-9, "300 ms of real time at 4x");
  assert.equal(beatSeconds(1, true), 0.4, "Reduce motion keeps a short beat");
  assert.ok(Math.abs(beatSeconds(4, true) / 4 - 0.3) < 1e-9);
});

test("the last beat is asked at the playing speed and at the reduced length", async () => {
  for (const [speed, reduced, want] of [
    [4, false, beatSeconds(4, false)],
    [1, true, 0.4],
  ] as const) {
    const st = stage({ instant: true, reduced });
    const pb = new Playback(growing(GAME, true).source, st.stage);
    pb.setSpeed(speed);
    pb.start();
    await tick(40);
    assert.equal(st.waits.at(-1), want);
    assert.equal(pb.getState().finished, true);
  }
});

test("a pause during the final animation or the beat holds the result; play goes on", async () => {
  const st = stage({ manualWait: true });
  const pb = new Playback(growing(GAME, true).source, st.stage);
  pb.start({ paused: false });
  for (let i = 0; i < 40 && pb.getState().cursor < GAME.length; i++) {
    st.release();
    st.endWaits();
    await tick();
  }
  pb.pause();
  await tick();
  assert.equal(pb.getState().finished, false, "paused in the last animation");
  pb.play();
  assert.equal(pb.getState().finished, false, "play resumes it, it does not restart");
  st.release();
  await tick();
  pb.pause();
  assert.equal(pb.getState().finished, false, "paused in the beat");
  pb.play();
  st.endWaits();
  await tick();
  assert.equal(pb.getState().finished, true);
  assert.equal(st.presented.filter((e) => e === GAME[LAST]).length, 1);
  pb.dispose();
});

test("seeking shows the end at once: jump, next past the end, and a restart during the beat", async () => {
  const st = stage({ manualWait: true });
  const pb = new Playback(growing(GAME, true).source, st.stage);
  pb.start({ paused: true });
  await tick();
  pb.jump(2);
  await tick();
  assert.equal(pb.getState().finished, false);
  pb.nextTurn();
  await tick();
  assert.equal(pb.getState().finished, true, "next turn past the end");
  assert.equal(st.pendingWaits.length, 0, "no beat for a seek");
  pb.prevTurn();
  await tick();
  assert.equal(pb.getState().finished, false, "stepping back hides it at once");
  pb.nextTurn();
  await tick();
  pb.nextTurn();
  await tick();
  assert.equal(pb.getState().finished, true);
  // Play to the end, then restart in the beat.
  pb.jump(2);
  await tick();
  pb.play();
  for (let i = 0; i < 40 && pb.getState().cursor < GAME.length; i++) {
    st.release();
    st.endWaits();
    await tick();
  }
  st.release();
  await tick();
  assert.equal(pb.getState().finished, false, "in the beat");
  pb.restart();
  await tick();
  assert.equal(pb.getState().finished, false);
  assert.equal(pb.getState().cursor, 1, "starts over cleanly");
  pb.dispose();
});

test("a live game that ends while watched plays its last events, then the beat, then the result", async () => {
  const st = stage({ manualWait: true });
  const game = growing(GAME.slice(0, 5));
  const pb = new Playback(game.source, st.stage);
  pb.start({ at: "live" });
  await tick();
  game.push(GAME[5], GAME[6]);
  game.end();
  await tick();
  assert.equal(pb.getState().finished, false);
  for (let i = 0; i < 20 && pb.getState().cursor < GAME.length; i++) {
    st.release();
    st.endWaits();
    await tick();
  }
  assert.equal(pb.getState().finished, false, "the last event is playing");
  st.release();
  await tick();
  assert.equal(pb.getState().finished, false, "the beat");
  st.endWaits();
  await tick();
  assert.equal(pb.getState().finished, true);
  pb.dispose();
});

test("a game with no last animation (a forfeit) still gets the beat after its last played event", async () => {
  const st = stage({ instant: true, manualWait: true });
  const game = growing(GAME);
  const pb = new Playback(game.source, st.stage);
  pb.start({ at: "live" });
  await tick();
  game.push(move("z"));
  await tick();
  game.end();
  await tick();
  assert.equal(pb.getState().finished, false, "the beat runs after the last event");
  st.endWaits();
  await tick();
  st.endWaits();
  await tick();
  assert.equal(pb.getState().finished, true);
  pb.dispose();
});

test("a viewer paused at the live edge when the game ends sees the result at once", async () => {
  const st = stage({ instant: true });
  const game = growing(GAME);
  const pb = new Playback(game.source, st.stage);
  pb.start({ at: "live" });
  await tick();
  game.push(move("z"));
  await tick();
  pb.pause();
  game.end();
  await tick();
  assert.equal(pb.getState().finished, true);
  pb.dispose();
});

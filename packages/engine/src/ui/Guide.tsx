// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * A guided run over the field (`<Encounter guide>`): one compact card with the
 * step's order, its counter and its commands, and the step's pointers — tiles
 * outlined on the ground and units bracketed, both projected each rendered
 * frame, and HUD controls outlined in place. Controls the step holds back are
 * dimmed. The card names the controls of the input in use and switches live;
 * a finger sees no key or button. It sits at the top, or above the command bar
 * when the top would cover what the step points at.
 *
 * This component only reads the session and feeds the guide snapshots; the
 * guide decides (`guide/run.ts`, `guide/director.ts`).
 */
import { Fragment, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import * as T from "three";
import { actionSpec, isThrowOrder } from "../action-registry";
import { audio } from "../audio";
import { onPad, padGlyph, padKind, type PadButton } from "../gamepad";
import { CELL, type Cell } from "../map";
import { combatActionOf, PAD_COMBAT_ACTIONS, type CombatAction, type PadCombatAction } from "../keys";
import { session, type Session } from "../session";
import { engineSettings } from "../settings";
import { snapshotOf } from "../guide/snapshot";
import { restage, select } from "../actions";
import { coverRelation, groundAfter } from "../guide/cover";
import { simPalette, SimulationConstructs, type SimRelation } from "../guide/sim-scene";
import type { Guide } from "../guide/run";
import { stageAt, stageStart } from "../guide/director";
import type { CameraTravel, GuideIntent, HudTarget, Pointer } from "../guide/types";
import { CARD } from "../guide/basics/copy";
import { Glyph, useInputMode, usePad } from "./Hud";
import { cap } from "./view";
import { useSession } from "./useSession";
import { closeInspect, hoverUnit } from "./intel/store";
import "../guide/guide.css";

type Input = "keys" | "pad" | "touch";

function useGuide(guide: Guide) {
  useSyncExternalStore(guide.subscribe, guide.getVersion);
  return guide;
}

/** The input the copy is written for: a finger, a pad in use, or keys and a mouse. */
function useInput(): Input {
  const pad = usePad();
  return useInputMode() === "touch" ? "touch" : pad ? "pad" : "keys";
}

// === The HUD's controls by name ===

const HUD_SELECTOR: Record<string, (s: Session) => string> = {
  "end-turn": () => ".hud-end-turn",
  confirm: () => ".hud-bar-cmd[data-tone='primary']",
  odds: () => ".hud-aim-odds",
  "unit-hp": () => ".hud-unit-condition > div:nth-child(1) dd",
  "unit-ap": () => ".hud-unit-condition > div:nth-child(2) dd",
  "unit-ammo": () => ".hud-unit-condition > div:nth-child(3) dd",
};

/** The element a HUD target names, if it is on screen. */
function hudElement(root: HTMLElement, s: Session, target: HudTarget): HTMLElement | null {
  if (target.startsWith("command:")) return root.querySelector(`.hud-cmd[data-kind="${target.slice(8)}"]`);
  if (target === "aim-next")
    return [...root.querySelectorAll<HTMLElement>(".hud-bar-commands .hud-bar-cmd")].find((b) => /next/i.test(b.textContent ?? "")) ?? null;
  if (target.startsWith("member:")) {
    const index = s.game.units.filter((u) => !u.enemy).findIndex((u) => u.id === target.slice(7));
    return root.querySelectorAll<HTMLElement>(".hud-squad .hud-member")[index] ?? null;
  }
  const selector = HUD_SELECTOR[target]?.(s);
  return selector ? root.querySelector(selector) : null;
}

// === Copy with control tokens ===

/** A pad token: a bindable pad action reads the player's button, anything else is the button itself. */
function padButton(name: string): PadButton | "dpad" | "ls" | "rs" | "" {
  if ((PAD_COMBAT_ACTIONS as string[]).includes(name)) return engineSettings().padCombat()[name as PadCombatAction];
  return name as PadButton | "dpad" | "ls" | "rs";
}

const FACE = new Set(["a", "b", "x", "y"]);
const SHOULDER = new Set(["lb", "rb", "lt", "rt"]);

/** A line of copy with its `{key:…}`, `{pad:…}` and `{cap:…}` tokens drawn as glyphs. */
function Line({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const pattern = /\{(key|pad|cap):([^}]+)\}/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index! > last) parts.push(text.slice(last, match.index));
    const [, kind, name] = match;
    if (kind === "key") parts.push(<kbd className="hud-glyph" data-shape="key">{cap(name as CombatAction) || "?"}</kbd>);
    else if (kind === "cap") parts.push(<kbd className="hud-glyph" data-shape="key">{name}</kbd>);
    else {
      const button = padButton(name);
      const shape = FACE.has(button) ? "face" : SHOULDER.has(button) ? "bumper" : "key";
      parts.push(
        <kbd className="hud-glyph" data-shape={shape} data-pad={padKind()}>
          {button ? padGlyph(button) : "?"}
        </kbd>,
      );
    }
    last = match.index! + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return (
    <p className="guide-line">
      {parts.map((part, i) => (
        <Fragment key={i}>{part}</Fragment>
      ))}
    </p>
  );
}

// === Projection ===

const corner = new T.Vector3();

/** A cell's outline on screen, inset a little, in the layer's pixels; null when it is behind the camera. */
function cellOutline(s: Session, [x, z]: Cell, offset: { x: number; y: number }): [number, number][] | null {
  const { battlefield } = s;
  const { w, h } = battlefield.viewSize;
  const half = CELL * 0.44;
  const points: [number, number][] = [];
  for (const [dx, dz] of [
    [-half, -half],
    [half, -half],
    [half, half],
    [-half, half],
  ]) {
    const wx = x * CELL + dx,
      wz = z * CELL + dz;
    corner.set(wx, s.game.map.surfaceHeight(wx, wz) + 0.06, wz).project(battlefield.camera);
    if (corner.z > 1) return null;
    points.push([offset.x + (corner.x * 0.5 + 0.5) * w, offset.y + (-corner.y * 0.5 + 0.5) * h]);
  }
  return points;
}

/** A pin standing over a tile: its foot on the ground and its head 2.6 m up, on screen; null behind the camera. */
function tilePin(s: Session, [x, z]: Cell, offset: { x: number; y: number }): [[number, number], [number, number]] | null {
  const { battlefield } = s;
  const { w, h } = battlefield.viewSize;
  const wx = x * CELL,
    wz = z * CELL;
  const ground = s.game.map.surfaceHeight(wx, wz);
  const out: [number, number][] = [];
  for (const y of [ground + 0.3, ground + 2.6]) {
    corner.set(wx, y, wz).project(battlefield.camera);
    if (corner.z > 1) return null;
    out.push([offset.x + (corner.x * 0.5 + 0.5) * w, offset.y + (-corner.y * 0.5 + 0.5) * h]);
  }
  return [out[0], out[1]];
}

/** The pointers resolved for the step on view: the step's own, or the operator to select first. */
function pointersOf(guide: Guide): { pointers: Pointer[]; selectFirst: string | null } {
  const step = guide.step;
  const now = guide.snapshot;
  if (!step || !now || guide.state.view !== guide.state.index) return { pointers: [], selectFirst: null };
  if (step.unit && now.selected !== step.unit && !now.busy) {
    const name = session.game.unit(step.unit)?.name ?? step.unit;
    return { pointers: [{ unit: step.unit }, { hud: `member:${step.unit}` }], selectFirst: name };
  }
  return { pointers: step.point?.(now) ?? [], selectFirst: null };
}

/** How wide the card is when it stands at the right of a wide screen, in px (with its margin). */
const SIDE_CARD = 416;
/** The card's commands, left to right: each keeps its place whether or not the step offers it. */
const SLOTS = ["skip", "lessons", "back", "primary"] as const;
type Slot = (typeof SLOTS)[number];
/** A screen wide enough for the card at the side, leaving the room most of it. */
const sideCard = (w: number, h: number) => w >= 760 && w > h * 1.15;

/** The run's lessons with what this device has done, and the one being played. */
function lessonsOf(guide: Guide) {
  return (guide.script.stages ?? []).map((x) => ({
    ...x,
    done: !!guide.host.done?.includes(x.id),
    current: x.id === guide.stage,
  }));
}

// === The overlay ===

export function GuideLayer({ guide }: { guide: Guide }) {
  const s = useSession();
  useGuide(guide);
  const input = useInput();
  const layer = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLElement>(null);
  const tiles = useRef<SVGSVGElement>(null);
  const travel = useRef<CameraTravel>({ turned: 0, zoomed: 0, panned: 0 });
  /** Where the card sits: at the top, or above the command bar, as a `top` in the layer's pixels once measured. */
  const [place, setPlace] = useState<{ at: "top" | "bottom" | "side"; y: number | null }>({ at: "top", y: null });
  const [armed, setArmed] = useState(false);
  const [nudge, setNudge] = useState<string | null>(null);
  /** The pad's way into the card's own commands: open, and which one has the cursor; the chapter list. */
  const [menu, setMenu] = useState<{ open: boolean; index: number; list: boolean; row: number }>({
    open: false,
    index: 0,
    list: false,
    row: 0,
  });
  const relationLabel = useRef<HTMLDivElement>(null);
  const relationRef = useRef<{ from: string; to: string; text: string } | null>(null);
  const framing = useRef(false);
  const framedDistance = useRef(0);
  const opened = useRef(false);
  const handPending = useRef(0);
  /** Bumps each time the room rebuilds: the scan sweeps the screen. */
  const [beat, setBeat] = useState(0);
  /** What the last step's completion said ("Turned"), shown as the next card comes in. */
  const [ack, setAck] = useState<{ text: string; at: number } | null>(null);
  const lastIndex = useRef(guide.state.index);
  const prepared = useRef<object | null>(null);
  const ready = s.state === "ready";
  const hidden = !ready || s.paused || s.panel !== null || guide.state.left;

  /** Feed the guide the field as it stands. */
  const look = () => {
    if (s.state !== "ready") return;
    // A new game (the first, or a restart): the script sets the field up once its loadouts are on.
    if (prepared.current !== s.game) {
      prepared.current = s.game;
      if (guide.script.prepare) {
        guide.script.prepare(s.game);
        queueMicrotask(() => s.changed());
      }
    }
    guide.update(
      snapshotOf(
        s.game,
        {
          selected: s.selected,
          mode: s.mode,
          target: s.target,
          grenadeTarget: s.grenadeTarget,
          busy: s.busy,
          covered: s.panel !== null || s.paused,
        },
        travel.current,
        guide.gameNumber(s.game),
      ),
    );
  };
  const lookRef = useRef(look);
  lookRef.current = look;

  /** The run moved on to a new lesson (or one was picked from the list): the room rebuilds around the player, on the same field. */
  function rebuild() {
    const want = guide.wantsStage();
    if (!want || !ready || s.busy || s.paused || !guide.script.stageScenario) return;
    guide.restaged(want);
    if (restage(guide.script.stageScenario(want))) {
      setBeat((n) => n + 1);
      // The lesson's operator in hand at once: one press less between lessons.
      handPending.current = 3;
    }
  }
  // A lesson picked from the list changes the run, not the field: the rebuild follows the run too.
  const guideVersion = guide.getVersion();
  useEffect(() => {
    rebuild();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guideVersion]);

  // Every change to the session is a new look at the field.
  useEffect(() => {
    lookRef.current();
    // Opened on a lesson whose first order is for one operator: that operator in hand.
    if (ready && !opened.current) {
      opened.current = true;
      const first = guide.step?.unit;
      if (first && !s.selected) select(first);
    }
    rebuild();
    // After a rebuild (a lesson finished, or one picked from the list): select the step's operator
    // as soon as the field takes it.
    if (handPending.current > 0 && ready && !s.busy && !s.paused && !guide.wantsStage()) {
      const first = guide.step?.unit;
      if (!first || s.selected === first) handPending.current = 0;
      else {
        handPending.current--;
        if (s.game.unit(first)?.hp) select(first);
      }
    }
  }, [s.version, s.paused]);

  // A step done: nothing lingers behind the card, no unit readout, no status line from the order before.
  useEffect(() => {
    if (!ready) return;
    closeInspect();
    hoverUnit(null);
    const said = s.feedback;
    if (!said) return;
    const timer = setTimeout(() => {
      if (s.feedback !== said) return;
      s.feedback = null;
      s.changed();
    }, 1200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, guide.state.index]);

  // A refused order: the card says what to do for a few seconds.
  useEffect(() => {
    if (!guide.nudge?.text) return;
    setNudge(guide.nudge.text);
    const timer = setTimeout(() => setNudge(null), 2800);
    return () => clearTimeout(timer);
  }, [guide.nudge]);

  // A step done: say it registered while the next one comes in.
  useEffect(() => {
    const from = lastIndex.current;
    lastIndex.current = guide.state.index;
    if (guide.state.index <= from || guide.passed === from) return;
    const text = guide.script.copy[guide.steps[from]?.id]?.ack;
    if (!text) return;
    setAck({ text, at: Date.now() });
    const timer = setTimeout(() => setAck(null), 2200);
    return () => clearTimeout(timer);
  }, [guide.state.index, guide]);

  // The skip disarms itself.
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);

  const { pointers, selectFirst } = pointersOf(guide);
  const aimer = s.selectedUnit(),
    aimed = s.targetUnit();
  const heldTarget =
    aimer && aimed && s.mode === "fire" && !s.busy && !guide.allows({ type: "fire", unit: aimer.id, target: aimed.id }) ? aimed.name : null;
  // New pointers are drawn on the next frame: ask for one, the field may be at rest.
  const drawn = hidden ? "" : JSON.stringify(pointers);
  useEffect(() => {
    if (ready) s.battlefield.invalidate();
  }, [drawn, ready, s]);

  // HUD: the step's controls outlined, the ones it holds back dimmed.
  useLayoutEffect(() => {
    const root = layer.current?.closest<HTMLElement>(".encounter");
    if (!root || !ready) return;
    const marked: HTMLElement[] = [];
    const mark = (el: Element | null, attr: string) => {
      if (!el) return;
      (el as HTMLElement).setAttribute(attr, "");
      marked.push(el as HTMLElement);
    };
    if (!hidden) {
      for (const p of pointers) {
        if (!("hud" in p)) continue;
        const el = hudElement(root, s, p.hud);
        mark(el, "data-guide-point");
        // The orders slide sideways on a phone: bring the one pointed at into the bar's view.
        const strip = el?.closest<HTMLElement>(".hud-bar-commands");
        if (el && strip && strip.scrollWidth > strip.clientWidth) {
          const [a, b] = [el.getBoundingClientRect(), strip.getBoundingClientRect()];
          if (a.left < b.left || a.right > b.right) strip.scrollLeft += a.left - b.left - (b.width - a.width) / 2;
        }
      }
      const u = s.selectedUnit();
      const allows = (intent: GuideIntent) => guide.allows(intent);
      for (const el of root.querySelectorAll(".hud-cmd[data-kind]")) {
        const order = actionSpec((el as HTMLElement).dataset.kind ?? "")?.order;
        if (u && order && order !== "move" && !allows({ type: "arm", unit: u.id, order })) mark(el, "data-guide-lock");
      }
      if (!allows({ type: "end-turn" })) mark(root.querySelector(".hud-end-turn"), "data-guide-lock");
      const allies = s.game.units.filter((a) => !a.enemy);
      root.querySelectorAll(".hud-squad .hud-member").forEach((el, i) => {
        // An operator waiting outside the room is not in this lesson: off the rail altogether.
        if (allies[i] && !s.game.map.inBounds(allies[i].pos)) mark(el, "data-guide-parked");
        else if (allies[i] && !allows({ type: "select", unit: allies[i].id })) mark(el, "data-guide-lock");
      });
      const confirm = root.querySelector(".hud-bar-cmd[data-tone='primary']");
      const target = s.targetUnit();
      if (u && s.mode === "fire" && target && !allows({ type: "fire", unit: u.id, target: target.id }))
        mark(confirm, "data-guide-lock");
      if (u && isThrowOrder(s.mode) && s.grenadeTarget && !allows({ type: "throw", unit: u.id, order: s.mode, at: s.grenadeTarget }))
        mark(confirm, "data-guide-lock");
    }
    return () => {
      for (const el of marked) {
        el.removeAttribute("data-guide-point");
        el.removeAttribute("data-guide-lock");
        el.removeAttribute("data-guide-parked");
      }
    };
  });

  // Each rendered frame: the camera's travel, the ground and unit pointers, and where the card sits.
  useEffect(() => {
    if (!ready) return;
    const { battlefield } = s;
    const last = { azimuth: NaN, distance: NaN, x: NaN, z: NaN };
    let placedAt = 0;
    const frame = () => {
      // The camera's travel, for the step that asks to look around.
      const cam = battlefield.camera.position,
        focus = battlefield.controls.target;
      const azimuth = Math.atan2(cam.x - focus.x, cam.z - focus.z);
      const distance = cam.distanceTo(focus);
      if (!Number.isNaN(last.azimuth)) {
        const turn = Math.abs(Math.atan2(Math.sin(azimuth - last.azimuth), Math.cos(azimuth - last.azimuth)));
        const zoom = Math.abs(distance - last.distance) / Math.max(distance, 1);
        const pan = Math.hypot(focus.x - last.x, focus.z - last.z);
        if (turn + zoom + pan > 1e-4 && !framing.current) {
          const t = travel.current;
          travel.current = { turned: t.turned + turn, zoomed: t.zoomed + zoom, panned: t.panned + pan };
          if (guide.step?.ticks || guide.step?.frame === false) lookRef.current();
        }
      }
      Object.assign(last, { azimuth, distance, x: focus.x, z: focus.z });
      drawPointers();
      placeRelationLabel();
      declutterLabels();
      if (sim.current?.rise(1 / 60)) battlefield.invalidate();
      const now = performance.now();
      if (now - placedAt > 400) {
        placedAt = now;
        placeCard();
      }
    };
    battlefield.frameHooks.add(frame);
    battlefield.invalidate();
    return () => void battlefield.frameHooks.delete(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);


  // === The simulation: its constructs over the floor, rebuilt as the field changes ===
  const sim = useRef<SimulationConstructs | null>(null);
  const simGame = useRef<object | null>(null);
  const hits = useRef(0);
  const [glitch, setGlitch] = useState(0);
  const simulated = !!guide.script.simulation && !!s.game.scenario.ground;
  useEffect(() => {
    if (!ready || !simulated) return;
    const constructs = new SimulationConstructs(simPalette());
    s.battlefield.scene.add(constructs.group);
    sim.current = constructs;
    return () => {
      constructs.dispose();
      sim.current = null;
      s.battlefield.invalidate();
    };
  }, [ready, simulated, s]);

  /** Who covers whom right now: the step's pair, else the target in sight against the operator in hand. */
  function relationNow(): { relation: SimRelation; from: string; to: string } | null {
    const step = guide.step;
    const now = guide.snapshot;
    if (!guide.script.relations || !now || hidden || s.mode !== "move" || s.game.result) return null;
    const pair = step?.relation?.(now) ?? null;
    // Only the room counts: units waiting outside it are no one's concern.
    const inRoom = (u: { pos: Cell }) => s.game.map.inBounds(u.pos);
    const allies = s.game.allies.filter(inRoom);
    const to = s.game.unit(pair?.[1] ?? s.selected) ?? (allies.length === 1 ? allies[0] : undefined);
    if (!to || to.enemy || to.hp <= 0) return null;
    const asked = s.game.unit(pair?.[0] ?? s.target);
    const from =
      asked && asked.enemy && asked.hp > 0
        ? asked
        : [...s.game.enemies].filter(inRoom).sort((a, b) => Math.abs(a.pos[0] - to.pos[0]) + Math.abs(a.pos[1] - to.pos[1]) - (Math.abs(b.pos[0] - to.pos[0]) + Math.abs(b.pos[1] - to.pos[1])))[0];
    if (!from) return null;
    const ground = groundAfter(s.game.scenario.ground!, s.game.events);
    const sight = !s.game.shotBlocked(from.pos, to.pos);
    return { relation: { from: [...from.pos], to: [...to.pos], cover: coverRelation(ground, from.pos, to.pos), sight }, from: from.id, to: to.id };
  }

  // Every look at the field: the constructs and the cover line follow it.
  useEffect(() => {
    const constructs = sim.current;
    if (!ready || !constructs) return;
    const ground = groundAfter(s.game.scenario.ground!, s.game.events);
    const rel = relationNow();
    const origin: Cell = [s.game.scenario.ground!.minX, s.game.scenario.ground!.minZ];
    const fresh = simGame.current !== s.game;
    simGame.current = s.game;
    const changed = constructs.update(ground, origin, s.game.units, rel?.relation ?? null, fresh);
    constructs.lightTargets(s.game.enemies.filter((e) => s.game.map.inBounds(e.pos)).map((e) => e.pos));
    if (fresh) {
      // The field's camera stays close: the room, never the void around it.
      s.battlefield.controls.maxDistance = framedDistance.current ? framedDistance.current * 1.3 : s.battlefield.viewSize.w < s.battlefield.viewSize.h ? 46 : 30;
      s.battlefield.controls.maxTargetRadius = 9;
    }
    // A hit: the simulation glitches for a beat.
    const shots = s.game.events.filter((e) => e.type === "shot" && e.hit).length;
    if (shots > hits.current && !fresh) setGlitch((n) => n + 1);
    hits.current = shots;
    if (rel) {
      const from = s.game.unit(rel.from)!,
        to = s.game.unit(rel.to)!;
      const chance = rel.relation.sight ? s.game.chance(from, to) : 0;
      const why = !rel.relation.sight
        ? CARD.relation.noLine
        : !s.game.inRange(from, to)
          ? CARD.relation.range
        : rel.relation.cover.value >= 50
          ? CARD.relation.high
          : rel.relation.cover.value > 0
            ? CARD.relation.low
            : CARD.relation.flanked;
      relationRef.current = { from: from.id, to: to.id, text: CARD.relation.label(from.name, to.name, chance, why) };
    } else relationRef.current = null;
    if (changed) s.battlefield.invalidate();
    placeRelationLabel();
  });

  /** The cover line's label at its middle, on the projected line. */
  function placeRelationLabel() {
    const el = relationLabel.current;
    const host = layer.current;
    const rel = relationRef.current;
    if (!el || !host) return;
    const a = rel && s.battlefield.unitBox(rel.from),
      b = rel && s.battlefield.unitBox(rel.to);
    if (!rel || !a || !b) {
      el.hidden = true;
      return;
    }
    const origin = host.getBoundingClientRect(),
      view = s.battlefield.host.getBoundingClientRect();
    const x = view.left - origin.left + (a.x + a.w / 2 + b.x + b.w / 2) / 2,
      y = view.top - origin.top + (a.y + a.h * 0.4 + b.y + b.h * 0.4) / 2;
    el.hidden = false;
    if (el.textContent !== rel.text) el.textContent = rel.text;
    // Kept on the glass: a pair near the edge pushes the label inwards, never off screen.
    const half = el.offsetWidth / 2 + 8,
      room = host.clientWidth;
    const cx = half * 2 >= room ? room / 2 : Math.min(Math.max(x, half), room - half);
    el.style.transform = `translate3d(${cx | 0}px,${y | 0}px,0) translate(-50%, -50%)`;
  }

  /** Unit name plates that land on each other (two targets side by side on a phone): the later one steps up above the other. */
  function declutterLabels() {
    const root = layer.current?.closest<HTMLElement>(".encounter");
    if (!root) return;
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    const labels = [...root.querySelectorAll<HTMLElement>(".unit-label")].filter((el) => !el.hidden && el.style.display !== "none");
    const boxes = labels.map((el) => {
      const r = el.getBoundingClientRect();
      const lift = Number(el.dataset.lift ?? 0);
      return { el, x: r.left, y: r.top + lift, w: r.width, h: r.height };
    });
    boxes.sort((a, b) => b.y - a.y || a.x - b.x);
    for (const box of boxes) {
      let lift = 0;
      for (const other of placed)
        if (box.x < other.x + other.w && other.x < box.x + box.w && box.y - lift < other.y + other.h && other.y < box.y - lift + box.h)
          lift = box.y - other.y + box.h + 2;
      placed.push({ ...box, y: box.y - lift });
      if (Number(box.el.dataset.lift ?? 0) !== lift) {
        box.el.dataset.lift = String(lift);
        box.el.style.translate = lift ? `0 ${-lift}px` : "";
      }
    }
  }

  // === The camera: each step frames the chapter's arena (looking around leaves it to the player) ===
  const reduced = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  /** The field's free band (pixels from the field's top) between a top or bottom card and the header or the bar. */
  function freeBand(): { height: number; middle: number } | null {
    const root = layer.current?.closest<HTMLElement>(".encounter");
    const el = card.current;
    if (!root || !el) return null;
    const view = s.battlefield.host.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    const header = root.querySelector(".hud-header")?.getBoundingClientRect().bottom ?? view.top;
    let bar = root.querySelector(".hud-bar")?.getBoundingClientRect().top ?? view.bottom;
    // The squad's portraits in a row above the bar (a phone) close the band too.
    const rail = root.querySelector(".hud-squad")?.getBoundingClientRect();
    if (rail && rail.height && rail.top > view.top + view.height / 2) bar = Math.min(bar, rail.top);
    const atTop = el.dataset.place !== "bottom";
    const top = (atTop ? Math.max(header, box.bottom) : header) - view.top;
    const bottom = (atTop ? bar : Math.min(bar, box.top)) - view.top;
    return bottom - top > 120 ? { height: bottom - top, middle: (top + bottom) / 2 } : null;
  }

  function frameCamera(cells: Cell[], instant: boolean) {
    const { battlefield } = s;
    const xs = cells.map((c) => c[0] * CELL),
      zs = cells.map((c) => c[1] * CELL);
    const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    const { w, h } = battlefield.viewSize;
    const side = sideCard(w, h);
    const vfov = (battlefield.camera.fov * Math.PI) / 180;
    // On a wide screen the card stands at the right: the room fits in what is left.
    const free = side ? w - SIDE_CARD : w;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * (free / Math.max(h, 1)));
    const span = Math.max(x1 - x0, z1 - z0) + CELL * 0.5;
    // Top and bottom cards: the room goes in the band between the card and the bar (or the header), not under them.
    const band = side ? null : freeBand();
    let distance: number;
    let shift = 0;
    if (band) {
      const vband = 2 * Math.atan(Math.tan(vfov / 2) * (band.height / Math.max(h, 1)));
      // Seen from the south and above, the room's depth shows at about 0.85 of its length.
      const fit = Math.max((span * 0.85) / 2 / Math.tan(vband / 2), span / 2 / Math.tan(hfov / 2));
      distance = Math.min(w < h ? 46 : 30, Math.max(10, fit * 1.12));
      // The band's middle below the screen's: the room moves down with it (the target north).
      const metresPerPixel = (2 * distance * Math.tan(vfov / 2)) / Math.max(h, 1) / Math.sin(0.95);
      shift = -(band.middle - h / 2) * metresPerPixel;
    } else {
      // Close: the room fills the free screen and nothing else shows, the command bar below it.
      distance = Math.min(w < h ? 44 : 30, Math.max(10, (span / 2 / Math.tan(Math.min(vfov, hfov) / 2)) * 1.16));
    }
    // Zooming out stops a little past the room.
    framedDistance.current = distance;
    battlefield.controls.maxDistance = distance * 1.3;
    const visible = 2 * distance * Math.tan((2 * Math.atan(Math.tan(vfov / 2) * (w / Math.max(h, 1)))) / 2);
    // North of the middle (above the bar); east by half the card when it stands at the side.
    const target = new T.Vector3(
      (x0 + x1) / 2 + (side ? (SIDE_CARD / 2 / w) * visible : 0),
      0,
      (z0 + z1) / 2 + (side ? CELL * 0.9 : band ? shift : CELL * -1.8),
    );
    // From the south, looking north: the targets at the top of the screen, the squad at the bottom.
    const elevation = 0.95;
    const position = target.clone().add(new T.Vector3(0, Math.sin(elevation) * distance, Math.cos(elevation) * distance));
    const controls = battlefield.controls;
    const fromTarget = controls.target.clone(),
      fromPosition = battlefield.camera.position.clone();
    framing.current = true;
    const settle = () => {
      controls.update();
      battlefield.invalidate();
    };
    if (instant || reduced) {
      controls.target.copy(target);
      battlefield.camera.position.copy(position);
      settle();
      framing.current = false;
      return;
    }
    const start = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / 650);
      const e = 1 - Math.pow(1 - t, 3);
      controls.target.copy(fromTarget).lerp(target, e);
      battlefield.camera.position.copy(fromPosition).lerp(position, e);
      settle();
      if (t < 1) setTimeout(step, 16);
      else framing.current = false;
    };
    // Timed, not tied to the page's frames: a framing always finishes, and the camera's travel counts again.
    setTimeout(step, 16);
  }
  const framedOnce = useRef(false);
  useEffect(() => {
    const cells = guide.script.frame;
    if (!ready || !cells?.length) return;
    if (!framedOnce.current) {
      framedOnce.current = true;
      frameCamera(cells, true);
      return;
    }
    const step = guide.step;
    // Every step starts on the lesson's framing, a camera lesson too: whatever the last one turned or panned comes back.
    if (!step || s.mode !== "move") return;
    frameCamera(cells, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, guide.state.index, guide.snapshot?.game]);

  const pointersRef = useRef(pointers);
  pointersRef.current = hidden ? [] : pointers;

  /** The tiles and units the step points at, drawn where the camera puts them now. */
  function drawPointers() {
    const svg = tiles.current;
    const host = layer.current;
    if (!svg || !host) return;
    const origin = host.getBoundingClientRect(),
      view = s.battlefield.host.getBoundingClientRect();
    const offset = { x: view.left - origin.left, y: view.top - origin.top };
    const shapes: string[] = [];
    /** Where each pointer is on screen, to flag the ones out of view at the edge. */
    const anchors: [number, number][] = [];
    for (const p of pointersRef.current) {
      if ("tiles" in p)
        for (const cell of p.tiles) {
          const outline = cellOutline(s, cell, offset);
          if (!outline) continue;
          anchors.push([outline.reduce((a, q) => a + q[0], 0) / 4, outline.reduce((a, q) => a + q[1], 0) / 4]);
          shapes.push(`<polygon class="guide-tile" data-tone="${p.tone ?? "go"}" points="${outline.map((q) => q.join(",")).join(" ")}"/>`);
          // A destination also stands a pin over the tile, so a wall or a crate in front of it never hides it.
          const pin = p.tone === "prop" ? null : tilePin(s, cell, offset);
          if (pin) {
            const [[gx, gy], [tx, ty]] = pin;
            shapes.push(
              `<path class="guide-pin" data-tone="${p.tone ?? "go"}" d="M${gx},${gy}L${tx},${ty}M${tx},${ty - 7}l5,7l-5,7l-5,-7z"/>`,
            );
          }
        }
      else if ("unit" in p) {
        const box = s.battlefield.unitBox(p.unit);
        const unit = s.game.unit(p.unit);
        if (!box || !unit) continue;
        const pad = 6,
          x0 = offset.x + box.x - pad,
          y0 = offset.y + box.y - pad,
          x1 = x0 + box.w + pad * 2,
          y1 = y0 + box.h + pad * 2;
        anchors.push([(x0 + x1) / 2, (y0 + y1) / 2]);
        const arm = Math.max(6, Math.min(14, box.w * 0.4));
        shapes.push(
          `<path class="guide-unit" data-enemy="${unit.enemy}" d="M${x0},${y0 + arm}V${y0}H${x0 + arm}M${x1 - arm},${y0}H${x1}V${y0 + arm}M${x1},${y1 - arm}V${y1}H${x1 - arm}M${x0 + arm},${y1}H${x0}V${y1 - arm}"/>`,
        );
      }
    }
    // Out of view: an arrow at the edge of the field, pointing the way to look.
    const root = host.closest<HTMLElement>(".encounter");
    const top = (root?.querySelector(".hud-header")?.getBoundingClientRect().bottom ?? origin.top) - origin.top + 16;
    const bottom = (root?.querySelector(".hud-bar")?.getBoundingClientRect().top ?? origin.bottom) - origin.top - 16;
    const left = 16,
      right = origin.width - 16;
    const cx = origin.width / 2,
      cy = (top + bottom) / 2;
    for (const [ax, ay] of anchors) {
      if (ax >= left && ax <= right && ay >= top && ay <= bottom) continue;
      const dx = ax - cx,
        dy = ay - cy;
      const t = Math.min(
        dx ? Math.abs((dx > 0 ? right - cx : cx - left) / dx) : Infinity,
        dy ? Math.abs((dy > 0 ? bottom - cy : cy - top) / dy) : Infinity,
      );
      const ex = cx + dx * t,
        ey = cy + dy * t;
      const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      shapes.push(`<path class="guide-edge" transform="translate(${ex},${ey}) rotate(${angle})" d="M2,0L-12,-9L-8,0L-12,9Z"/>`);
    }
    const markup = shapes.join("");
    if (svg.dataset.markup !== markup) {
      svg.dataset.markup = markup;
      svg.innerHTML = markup;
    }
  }

  /** Top unless the top covers more of what the step points at than the place above the command bar. */
  function placeCard() {
    const el = card.current;
    const host = layer.current;
    if (!el || !host) return;
    if (sideCard(host.clientWidth, host.clientHeight)) {
      setPlace((was) => (was.at === "side" ? was : { at: "side", y: null }));
      host.closest<HTMLElement>(".encounter")?.style.removeProperty("--guide-card-bottom");
      return;
    }
    const root = host.closest<HTMLElement>(".encounter");
    if (!root) return;
    // The card always stands at the top, in one place for the whole run: a card that moves between steps is read twice.
    const origin = host.getBoundingClientRect();
    const header = root.querySelector(".hud-header")?.getBoundingClientRect().bottom ?? origin.top;
    const y = Math.round(header + 12 - origin.top);
    // The status line keeps clear of the card.
    root.style.setProperty("--guide-card-bottom", `${y + el.offsetHeight}px`);
    setPlace((was) => (was.at === "top" && y === was.y ? was : { at: "top", y }));
  }

  // The HUD around the card changes with the field (a unit panel comes and goes): place it again after each render.
  useLayoutEffect(() => {
    if (ready && !hidden) placeCard();
  });
  useEffect(() => {
    const resized = () => placeCard();
    window.addEventListener("resize", resized);
    return () => window.removeEventListener("resize", resized);
  });

  /** The card's commands, in order: what a click, a tap, a key or the pad's card cursor presses. */
  type CardCommand = { id: string; slot: Slot; label: string; run: () => void; tone?: "primary" | "warn"; glyph?: ReactNode; title?: string };
  function cardCommands(): CardCommand[] {
    const view = guide.steps[guide.state.view];
    if (!view) return [];
    const closing = view === guide.steps[guide.steps.length - 1];
    const reading = guide.state.view < guide.state.index;
    const out: CardCommand[] = [];
    const lessons = (): CardCommand => ({ id: "chapters", slot: "lessons", label: CARD.lessons, run: () => setMenu((m) => ({ ...m, list: !m.list, row: 0 })) });
    // Each command has its own slot on the card, left to right: skip, lessons, back, then the one to press next.
    if (closing) {
      const exits = guide.host.exits ?? [];
      if (guide.script.stages?.length) out.push(lessons());
      if (exits[1]) out.push({ id: "exit-1", slot: "back", label: exits[1].label, run: exits[1].run });
      if (exits[0]) out.push({ id: "exit-0", slot: "primary", label: exits[0].label, run: exits[0].run, tone: "primary", glyph: <Glyph action="confirm" pad="a" /> });
      return out;
    }
    out.push({ id: "skip", slot: "skip", label: armed ? CARD.leaveNow : CARD.skip, title: armed ? CARD.leave : undefined, run: () => (armed ? guide.skip() : setArmed(true)), tone: armed ? "warn" : undefined });
    if (guide.script.stages?.length) out.push(lessons());
    if (guide.state.view > 0)
      out.push({
        id: "back",
        slot: "back",
        label: CARD.back,
        run: () => guide.back(),
        glyph: input === "keys" ? <kbd className="hud-glyph" data-shape="key">⌫</kbd> : undefined,
      });
    if (reading) out.push({ id: "next", slot: "primary", label: guide.state.view + 1 === guide.state.index ? CARD.current : CARD.next, run: () => guide.forward() });
    else if (view.confirm)
      out.push({ id: "continue", slot: "primary", label: CARD.continue, run: () => guide.proceed(), tone: "primary", glyph: <Glyph action="confirm" pad="a" /> });
    // A control lesson is never a wall: Next passes it however the player's hands are set up.
    else if (view.passable) out.push({ id: "pass", slot: "primary", label: CARD.next, run: () => guide.proceed(), glyph: <Glyph action="confirm" pad="a" /> });
    return out;
  }
  const commandsRef = useRef<CardCommand[]>([]);
  const menuRef = useRef(menu);
  menuRef.current = menu;

  // The card's own keys: the confirm key continues a step that only tells (or takes the closing card's way on), Backspace reads back.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (s.state !== "ready" || s.paused || s.dialogOpen || guide.state.left) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest("input, select, textarea, [contenteditable]")) return;
      if (e.key === "Backspace" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        audio.tone("click");
        guide.back();
        return;
      }
      const step = guide.step;
      const closing = !!step && step === guide.steps[guide.steps.length - 1];
      if (combatActionOf(e, engineSettings().combatKeys()) === "confirm" && guide.state.view === guide.state.index && (step?.confirm || step?.passable || closing)) {
        if (target?.closest("button")) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        audio.tone("click");
        if (closing) guide.host.exits?.[0]?.run();
        else guide.proceed();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [s, guide]);

  // Pan by keys in a guided run (a trackpad cannot always right-drag): W A S D or the arrows slide the view.
  useEffect(() => {
    const PAN: Record<string, [number, number]> = {
      w: [0, 1], arrowup: [0, 1], s: [0, -1], arrowdown: [0, -1], a: [-1, 0], arrowleft: [-1, 0], d: [1, 0], arrowright: [1, 0],
    };
    const onKey = (e: KeyboardEvent) => {
      const dir = PAN[e.key.toLowerCase()];
      if (!dir || e.ctrlKey || e.metaKey || e.altKey || s.state !== "ready" || s.paused || s.dialogOpen || guide.state.left) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest("input, select, textarea, [contenteditable]")) return;
      const { camera, controls } = s.battlefield;
      const ahead = controls.target.clone().sub(camera.position).setY(0);
      if (ahead.lengthSq() < 1e-6) return;
      ahead.normalize();
      const right = new T.Vector3(-ahead.z, 0, ahead.x);
      const move = ahead.multiplyScalar(dir[1]).add(right.multiplyScalar(dir[0])).multiplyScalar(CELL * 0.5);
      e.preventDefault();
      controls.target.add(move);
      camera.position.add(move);
      controls.update();
      s.battlefield.invalidate();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [s, guide]);

  /**
   * The pad. The tactical-grid button opens the card's own commands while a
   * guided run is on (the grid stays on the header's tool): the d-pad walks
   * them, A presses, B or the same button closes; the chapter list walks up
   * and down. Outside the card, A continues a step that only tells and takes
   * the closing card's first way on.
   */
  useEffect(
    () =>
      onPad((pad) => {
        if (s.state !== "ready" || s.paused || s.dialogOpen || guide.state.left || s.wheel) return false;
        const toggle = engineSettings().padCombat().grid;
        const m = menuRef.current;
        const commands = commandsRef.current;
        const chapters = lessonsOf(guide);
        if (toggle && pad.pressed(toggle)) {
          audio.tone("click");
          setMenu({ open: !m.open, index: 0, list: false, row: 0 });
          return true;
        }
        if (m.open) {
          if (pad.pressed("b")) {
            audio.tone("click");
            setMenu(m.list ? { ...m, list: false } : { ...m, open: false });
          } else if (m.list) {
            const n = chapters.length;
            if (pad.nav("down")) setMenu({ ...m, row: (m.row + 1) % n });
            else if (pad.nav("up")) setMenu({ ...m, row: (m.row + n - 1) % n });
            else if (pad.pressed("a") && chapters[m.row]) {
              audio.tone("click");
              setMenu({ open: false, index: 0, list: false, row: 0 });
              guide.jumpTo(chapters[m.row].id);
            }
          } else {
            const n = commands.length;
            if (pad.nav("right") || pad.nav("down")) setMenu({ ...m, index: (m.index + 1) % n });
            else if (pad.nav("left") || pad.nav("up")) setMenu({ ...m, index: (m.index + n - 1) % n });
            else if (pad.pressed("a") && commands[m.index]) {
              audio.tone("click");
              const command = commands[m.index];
              if (command.id !== "chapters" && command.id !== "skip") setMenu({ ...m, open: false });
              command.run();
            }
          }
          return true;
        }
        if (!pad.pressed("a")) return false;
        const step = guide.step;
        if ((step?.confirm || step?.passable) && guide.state.view === guide.state.index) {
          audio.tone("click");
          guide.proceed();
          return true;
        }
        if (step && step === guide.steps[guide.steps.length - 1] && guide.host.exits?.[0]) {
          audio.tone("click");
          guide.host.exits[0].run();
          return true;
        }
        return false;
      }, 20),
    [s, guide],
  );

  if (!ready) return null;
  const view = guide.steps[guide.state.view];
  const copy = view && guide.script.copy[view.id];
  const closing = !!view && view === guide.steps[guide.steps.length - 1];
  const reading = guide.state.view < guide.state.index;
  const total = guide.steps.length - 1;
  const ticks = !reading ? guide.ticks() : null;
  const commands = cardCommands();
  commandsRef.current = commands;
  // The lesson on view and where in it the step is.
  const stages = guide.script.stages ?? [];
  const viewStage = stageAt(guide.steps, guide.state.view);
  const lessonIndex = stages.findIndex((x) => x.id === viewStage);
  const first = stageStart(guide.steps, guide.state.view);
  const lessonEnd = guide.steps.findIndex((x, i) => i > first && (x.stage || i === guide.steps.length - 1));
  const stepOfLesson = guide.state.view - first + 1;
  const lessonSteps = (lessonEnd < 0 ? guide.steps.length - 1 : lessonEnd) - first;
  const press = (fn: () => void) => () => {
    audio.tone("click");
    fn();
  };
  /** One step's text: the live one, or an unseen copy of it that only reserves room. */
  const stepBody = (i: number, live: boolean) => {
    const step = guide.steps[i];
    const text = step && guide.script.copy[step.id];
    if (!text) return null;
    const stage = stageAt(guide.steps, i);
    const last = i === guide.steps.length - 1;
    return (
      <div key={live ? "live" : step.id} className="guide-step" data-sizer={live ? undefined : true} aria-hidden={live ? undefined : true}>
        <h2 className="guide-title">{text.title}</h2>
        {text.lines[input].map((line, k) => (
          <Line key={`${input}${k}`} text={line} />
        ))}
        {(live ? ticks : true) && text.ticks && (
          <ul className="guide-ticks" aria-label={live ? "Progress" : undefined}>
            {text.ticks.map((label, k) => (
              <li key={label} data-done={(live && ticks?.[k]) || undefined}>
                <i />
                {label}
              </li>
            ))}
          </ul>
        )}
        {!last && stage && guide.script.controls?.[stage] && (
          <div className="guide-controls" aria-label={live ? "Controls" : undefined}>
            {guide.script.controls[stage][input].map((line, k) => (
              <Line key={`c${input}${k}`} text={line} />
            ))}
          </div>
        )}
      </div>
    );
  };
  /** The lessons to jump to: the live list, or an unseen one that reserves its room. */
  const lessonList = (live: boolean) =>
    guide.script.stages ? (
      <ol key={live ? "lessons" : "lessons-size"} className="guide-chapters" data-sizer={live ? undefined : true} aria-hidden={live ? undefined : true} aria-label={live ? CARD.lessons : undefined}>
        {lessonsOf(guide).map((c, i) => (
          <li key={c.id}>
            <button
              type="button"
              className="hud-bar-cmd"
              tabIndex={live ? undefined : -1}
              data-cursor={(live && menu.open && i === menu.row) || undefined}
              data-current={c.current || undefined}
              onClick={
                live
                  ? press(() => {
                      setMenu({ open: false, index: 0, list: false, row: 0 });
                      guide.jumpTo(c.id);
                    })
                  : undefined
              }
            >
              <span>
                {i + 1}. {c.title}
              </span>
              {c.done && <small className="guide-tag">{CARD.done}</small>}
            </button>
          </li>
        ))}
      </ol>
    ) : null;
  const padOn = input === "pad";
  const gridButton = engineSettings().padCombat().grid;

  return (
    <div className="guide-layer" ref={layer} data-hidden={hidden || undefined}>
      <svg className="guide-tiles" ref={tiles} aria-hidden="true" />
      {beat > 0 && <div className="guide-scan" key={`scan${beat}`} aria-hidden="true" />}
      {glitch > 0 && <div className="guide-glitch" key={`glitch${glitch}`} aria-hidden="true" />}
      <div className="guide-relation" ref={relationLabel} hidden aria-hidden="true" />
      {!hidden && copy && (
        <aside
          ref={card}
          className="guide-card"
          data-place={place.at}
          style={place.y === null ? undefined : { top: place.y }}
          data-closing={closing || undefined}
          data-reading={reading || undefined}
          data-menu={menu.open || undefined}
          aria-live="polite"
          aria-label={copy.title}
        >
          <header className="guide-head">
            <small className="guide-eyebrow">
              {lessonIndex >= 0 && !closing
                ? CARD.lesson(lessonIndex + 1, stages.length, stages[lessonIndex].title)
                : s.game.scenario.briefing.title}
              {!closing && (
                <b>
                  {lessonIndex >= 0 ? stepOfLesson : guide.state.view + 1} / {lessonIndex >= 0 ? lessonSteps : total}
                </b>
              )}
            </small>
            {reading && <small className="guide-tag">{CARD.earlier}</small>}
            {padOn && gridButton && (
              <span className="guide-pad-hint" data-open={menu.open || undefined}>
                <Glyph pad={gridButton} />
                <span>{menu.open ? CARD.close : CARD.commands}</span>
              </span>
            )}
          </header>
          <div className="guide-body">
            {/* Every step's text laid under the live one, unseen: the card is as tall as the longest and never resizes. */}
            {guide.steps.map((_, i) => stepBody(i, false))}
            {lessonList(false)}
            <div className="guide-live" data-hidden={menu.list || undefined}>
              {stepBody(guide.state.view, true)}
            </div>
            {menu.list && lessonList(true)}
          </div>
          <div className="guide-status" aria-live="polite">
            {nudge && !reading ? (
              <p className="guide-nudge" key={guide.nudge?.at}>
                <i className="hud-warn-mark" />
                {nudge}
              </p>
            ) : selectFirst && !reading ? (
              <p className="guide-line" data-tone="warn">{CARD.selectFirst(selectFirst)}</p>
            ) : heldTarget && !reading ? (
              <p className="guide-line" data-tone="warn">
                {CARD.heldTarget(heldTarget)}
              </p>
            ) : ack && !reading ? (
              <p className="guide-ack" key={ack.at}>
                <i />
                {ack.text}
              </p>
            ) : null}
          </div>
          <div className="guide-commands">
            {SLOTS.map((slot) => {
              const command = commands.find((c) => c.slot === slot);
              if (!command) {
                if (slot !== "back" && slot !== "primary") return <span key={slot} className="guide-slot" data-slot={slot} />;
                return (
                  <button key={slot} type="button" className="hud-bar-cmd guide-slot" data-slot={slot} disabled>
                    <span>{slot === "back" ? CARD.back : CARD.next}</span>
                  </button>
                );
              }
              const i = commands.indexOf(command);
              return (
                <button
                  key={slot}
                  type="button"
                  className="hud-bar-cmd guide-slot"
                  data-slot={slot}
                  data-tone={command.tone === "primary" ? "primary" : undefined}
                  data-armed={command.tone === "warn" || undefined}
                  data-cursor={(menu.open && !menu.list && i === menu.index) || undefined}
                  title={command.title}
                  onClick={press(command.run)}
                >
                  {command.glyph}
                  <span>{command.label}</span>
                </button>
              );
            })}
          </div>
        </aside>
      )}
    </div>
  );
}

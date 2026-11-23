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
import type { Guide } from "../guide/run";
import type { CameraTravel, GuideIntent, HudTarget, Pointer } from "../guide/types";
import { CARD } from "../guide/basics/copy";
import { Glyph, useInputMode, usePad } from "./Hud";
import { cap } from "./view";
import { useSession } from "./useSession";
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

const overlap = (a: DOMRect | Box, b: Box) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

type Box = { x: number; y: number; width: number; height: number };

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
  const [place, setPlace] = useState<{ at: "top" | "bottom"; y: number | null }>({ at: "top", y: null });
  const [armed, setArmed] = useState(false);
  const [nudge, setNudge] = useState<string | null>(null);
  const ready = s.state === "ready";
  const hidden = !ready || s.paused || s.panel !== null || guide.state.left;

  /** Feed the guide the field as it stands. */
  const look = () => {
    if (s.state !== "ready") return;
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

  // Every change to the session is a new look at the field.
  useEffect(() => {
    lookRef.current();
  }, [s.version, s.paused]);

  // A refused order: the card says what to do for a few seconds.
  useEffect(() => {
    if (!guide.nudge?.text) return;
    setNudge(guide.nudge.text);
    const timer = setTimeout(() => setNudge(null), 2800);
    return () => clearTimeout(timer);
  }, [guide.nudge]);

  // The skip disarms itself.
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);

  const { pointers, selectFirst } = pointersOf(guide);
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
        if (allies[i] && !allows({ type: "select", unit: allies[i].id })) mark(el, "data-guide-lock");
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
        if (turn + zoom + pan > 1e-4) {
          const t = travel.current;
          travel.current = { turned: t.turned + turn, zoomed: t.zoomed + zoom, panned: t.panned + pan };
          if (guide.step?.ticks) lookRef.current();
        }
      }
      Object.assign(last, { azimuth, distance, x: focus.x, z: focus.z });
      drawPointers();
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
    const root = host.closest<HTMLElement>(".encounter");
    if (!root) return;
    const targets: Box[] = [];
    for (const p of pointersRef.current) {
      if ("hud" in p) {
        const r = hudElement(root, s, p.hud)?.getBoundingClientRect();
        if (r) targets.push(r);
      } else if ("unit" in p) {
        const box = s.battlefield.unitBox(p.unit);
        const view = s.battlefield.host.getBoundingClientRect();
        if (box) targets.push({ x: view.left + box.x, y: view.top + box.y, width: box.w, height: box.h });
      }
    }
    for (const shape of tiles.current?.querySelectorAll("polygon, path") ?? []) targets.push(shape.getBoundingClientRect());
    // The operator taking orders is worth keeping in sight too.
    const chosen = s.selected ? s.battlefield.unitBox(s.selected) : null;
    if (chosen) {
      const view = s.battlefield.host.getBoundingClientRect();
      targets.push({ x: view.left + chosen.x, y: view.top + chosen.y, width: chosen.w, height: chosen.h });
    }
    const height = el.offsetHeight;
    const width = el.offsetWidth;
    const origin = host.getBoundingClientRect();
    const left = origin.left + (origin.width - width) / 2;
    const header = root.querySelector(".hud-header")?.getBoundingClientRect().bottom ?? origin.top;
    const floor = Math.min(
      ...[".hud-unit", ".hud-bar"].map((q) => root.querySelector(q)?.getBoundingClientRect().top ?? origin.bottom),
    );
    const top = header + 12,
      bottom = floor - 12 - height;
    const at = (y: number): Box => ({ x: left, y, width, height });
    const cost = (box: Box) => targets.reduce((sum, t) => sum + overlap(t, box), 0);
    const up = cost(at(top)),
      down = bottom > top ? cost(at(bottom)) : Infinity;
    const style = root.style;
    setPlace((was) => {
      // Stay put unless the other place is clearly better: a card that jumps is read twice.
      const next = was.at === "top" ? (down < up * 0.6 ? "bottom" : "top") : up <= down * 1.2 ? "top" : "bottom";
      const y = Math.round((next === "top" ? top : bottom) - origin.top);
      // The status line keeps clear of a card at the top.
      if (next === "top") style.setProperty("--guide-card-bottom", `${y + height}px`);
      else style.removeProperty("--guide-card-bottom");
      return next === was.at && y === was.y ? was : { at: next, y };
    });
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

  // The card's own keys: the confirm key continues a step that only tells, Backspace reads back.
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
      if (combatActionOf(e, engineSettings().combatKeys()) === "confirm" && step?.confirm && guide.state.view === guide.state.index) {
        if (target?.closest("button")) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        audio.tone("click");
        guide.proceed();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [s, guide]);

  // The pad's A continues a step that only tells; on the closing card it takes the first way on.
  useEffect(
    () =>
      onPad((pad) => {
        if (s.state !== "ready" || s.paused || s.dialogOpen || guide.state.left) return false;
        if (!pad.pressed("a")) return false;
        const step = guide.step;
        if (step?.confirm && guide.state.view === guide.state.index) {
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
  const lines = copy ? copy.lines[input] : [];
  const press = (fn: () => void) => () => {
    audio.tone("click");
    fn();
  };

  return (
    <div className="guide-layer" ref={layer} data-hidden={hidden || undefined}>
      <svg className="guide-tiles" ref={tiles} aria-hidden="true" />
      {!hidden && copy && (
        <aside
          ref={card}
          className="guide-card"
          data-place={place.at}
          style={place.y === null ? undefined : { top: place.y }}
          data-closing={closing || undefined}
          data-reading={reading || undefined}
          aria-live="polite"
          aria-label={copy.title}
        >
          <header className="guide-head">
            <small className="guide-eyebrow">
              {s.game.scenario.briefing.title}
              {!closing && (
                <b>
                  {guide.state.view + 1} / {total}
                </b>
              )}
            </small>
            {reading && <small className="guide-tag">{CARD.earlier}</small>}
          </header>
          <h2 className="guide-title">{copy.title}</h2>
          {selectFirst && !reading && <p className="guide-line" data-tone="warn">{CARD.selectFirst(selectFirst)}</p>}
          {lines.map((line, i) => (
            <Line key={`${input}${i}`} text={line} />
          ))}
          {ticks && copy.ticks && (
            <ul className="guide-ticks" aria-label="Progress">
              {copy.ticks.map((label, i) => (
                <li key={label} data-done={ticks[i] || undefined}>
                  <i />
                  {label}
                </li>
              ))}
            </ul>
          )}
          {nudge && !reading && (
            <p className="guide-nudge" key={guide.nudge?.at}>
              <i className="hud-warn-mark" />
              {nudge}
            </p>
          )}
          <div className="guide-commands">
            {closing ? (
              guide.host.exits?.map((exit, i) => (
                <button
                  key={exit.label}
                  type="button"
                  className="hud-bar-cmd"
                  data-tone={i === 0 ? "primary" : undefined}
                  onClick={press(exit.run)}
                >
                  {i === 0 && <Glyph pad="a" />}
                  <span>{exit.label}</span>
                </button>
              ))
            ) : (
              <>
                {guide.state.view > 0 && (
                  <button type="button" className="hud-bar-cmd" onClick={press(() => guide.back())}>
                    {input === "keys" && <kbd className="hud-glyph" data-shape="key">⌫</kbd>}
                    <span>{CARD.back}</span>
                  </button>
                )}
                {reading && (
                  <button type="button" className="hud-bar-cmd" onClick={press(() => guide.forward())}>
                    <span>{guide.state.view + 1 === guide.state.index ? CARD.current : CARD.next}</span>
                  </button>
                )}
                <button
                  type="button"
                  className="hud-bar-cmd guide-skip"
                  data-armed={armed || undefined}
                  onClick={press(() => (armed ? guide.skip() : setArmed(true)))}
                >
                  <span>{armed ? CARD.leave : CARD.skip}</span>
                </button>
                {view.confirm && !reading && (
                  <button type="button" className="hud-bar-cmd" data-tone="primary" onClick={press(() => guide.proceed())}>
                    <Glyph action="confirm" pad="a" />
                    <span>{CARD.continue}</span>
                  </button>
                )}
              </>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}

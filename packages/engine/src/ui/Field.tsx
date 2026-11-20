// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useEffect, useRef, useState, type RefObject } from "react";
import { REFUSAL_SHORT, refusalOf } from "../action-registry";
import { confirmWheel, wheelEntries, type WheelEntry } from "../pad-combat";
import type { Session } from "../session";
import { Icon, Logo } from "./icons";
import { useSession } from "./useSession";
import { IntelLayer } from "./intel/IntelLayer";

export interface FieldRefs {
  viewport: RefObject<HTMLDivElement | null>;
  labels: RefObject<HTMLDivElement | null>;
  reticle: RefObject<HTMLDivElement | null>;
}

/** The 3D field and what is drawn on it: plates, the aim reticle, the pad's wheel, the status line. */
export function Field({ refs }: { refs: FieldRefs }) {
  const s = useSession();
  const targeting = s.state === "ready" && s.mode !== "move" && !s.game.result;
  return (
    <section
      className={`battlefield ${s.busy ? "executing" : ""} ${targeting ? "targeting" : ""}`}
      aria-label="Interactive 3D tactical battlefield"
    >
      <div id="viewport" ref={refs.viewport} />
      <div className="vignette" />
      <div id="world-labels" ref={refs.labels} />
      <IntelLayer />
      <Feedback />
      <div id="aim-reticle" ref={refs.reticle} aria-hidden="true" hidden>
        <i />
        <b />
      </div>
      {s.state === "ready" && <ActionWheel />}
      {s.state !== "ready" && (
        <div className="loading" id="loading">
          {s.state === "failed" ? (
            <p>3D renderer unavailable</p>
          ) : (
            <>
              <span>
                <Logo />
              </span>
              <p>Loading the match</p>
            </>
          )}
        </div>
      )}
    </section>
  );
}

/** Wheel geometry: a square SVG box, filled wedges between the hub and the rim. */
const WHEEL_BOX = 460;
const W_CX = WHEEL_BOX / 2;
const W_OUTER = 212;
const W_INNER = 92;
/** Degrees shaved off each wedge side; the dark channel between segments. */
const W_GAP = 1.6;

function polar(r: number, deg: number): string {
  const rad = (deg * Math.PI) / 180;
  return `${(W_CX + r * Math.cos(rad)).toFixed(1)} ${(W_CX + r * Math.sin(rad)).toFixed(1)}`;
}

/** A filled donut sector from `a0` to `a1` degrees, angles clockwise from 3 o'clock. */
function wedgePath(a0: number, a1: number): string {
  return [
    `M ${polar(W_OUTER, a0)}`,
    `A ${W_OUTER} ${W_OUTER} 0 0 1 ${polar(W_OUTER, a1)}`,
    `L ${polar(W_INNER, a1)}`,
    `A ${W_INNER} ${W_INNER} 0 0 0 ${polar(W_INNER, a0)}`,
    "Z",
  ].join(" ");
}

/** The wedges for `n` entries, and the selector arc over wedge 0 (a rotation moves it). */
function wheelGeometry(n: number) {
  const step = 360 / n;
  const wedges = Array.from({ length: n }, (_, i) => {
    const mid = i * step - 90;
    return wedgePath(mid - step / 2 + W_GAP, mid + step / 2 - W_GAP);
  });
  const r = W_OUTER + 9;
  const half = step / 2 - W_GAP;
  const arc = `M ${polar(r, -90 - half)} A ${r} ${r} 0 0 1 ${polar(r, -90 + half)}`;
  return { step, wedges, arc };
}

/** Whether the entry would land right now, and the hub's one-line reading of it: the registry's refusal. */
function wheelStatus(s: Session, entry: WheelEntry): { locked: boolean; note: string } {
  if (entry.id === "end-turn") return { locked: false, note: "PASS INITIATIVE" };
  const u = s.selectedUnit();
  if (!u) return { locked: true, note: "NO OPERATOR" };
  const refusal = refusalOf(s.game, u, entry.id);
  return refusal ? { locked: true, note: REFUSAL_SHORT[refusal] } : { locked: false, note: "READY" };
}

/** The controller's radial action menu, driven by the pad or the mouse: the unit's actions and End turn. */
function ActionWheel() {
  const s = useSession();
  /** The selector's unwrapped rotation, so the last → 0 is one step on, not a lap back. */
  const turned = useRef(0);
  const last = useRef(0);
  if (!s.wheel) return null;
  const entries = wheelEntries();
  const { step, wedges, arc } = wheelGeometry(entries.length);
  if (s.wheelIndex !== last.current) {
    const delta = (((s.wheelIndex - last.current) * step) % 360) + 540;
    turned.current += (delta % 360) - 180;
    last.current = s.wheelIndex;
  }
  const u = s.selectedUnit();
  const status = entries.map((e) => wheelStatus(s, e));
  const focused = status[s.wheelIndex] ?? status[0];
  const point = (i: number) => {
    if (s.wheelIndex === i) return;
    s.wheelIndex = i;
    s.changed();
  };
  return (
    <div id="action-wheel" role="menu" aria-label="Actions">
      <div className="wheel-ring">
        <svg viewBox={`0 0 ${WHEEL_BOX} ${WHEEL_BOX}`} aria-hidden="true">
          <circle className="wheel-rim" cx={W_CX} cy={W_CX} r={W_OUTER + 14} />
          <circle className="wheel-hub" cx={W_CX} cy={W_CX} r={W_INNER - 8} />
          {entries.map((a, i) => (
            <path
              key={a.id}
              className={`wheel-seg ${i === s.wheelIndex ? "focused" : ""} ${status[i].locked ? "locked" : ""}`}
              d={wedges[i]}
              onMouseEnter={() => point(i)}
              onClick={() => confirmWheel(i)}
            />
          ))}
          <g className="wheel-selector" style={{ transform: `rotate(${turned.current}deg)` }}>
            <path className="wheel-selector-arc" d={arc} />
            <path className="wheel-selector-tick" d={`M ${polar(W_INNER - 8, -90)} l 5 9 h -10 Z`} />
          </g>
        </svg>
        {entries.map((a, i) => {
          const rad = ((i * step - 90) * Math.PI) / 180;
          const x = Math.round(Math.cos(rad) * ((W_OUTER + W_INNER) / 2));
          const y = Math.round(Math.sin(rad) * ((W_OUTER + W_INNER) / 2));
          return (
            <button
              key={a.id}
              role="menuitem"
              className={`${i === s.wheelIndex ? "active" : ""} ${status[i].locked ? "locked" : ""}`}
              aria-disabled={status[i].locked || undefined}
              style={{ translate: `${x}px ${y}px` }}
              onClick={() => confirmWheel(i)}
            >
              <Icon name={a.id === "end-turn" ? "hourglass" : (a.icon ?? "unknown")} />
              <span>{a.label}</span>
            </button>
          );
        })}
        <div className="wheel-center" aria-hidden="true">
          <small>{u?.name ?? "SQUAD"}</small>
          <strong>{entries[s.wheelIndex]?.label}</strong>
          <span className={focused.locked ? "locked" : ""}>{focused.note}</span>
          {u && (
            <span className="wheel-ap">
              {[0, 1].map((j) => (
                <i key={j} className={u.ap > j ? "filled" : ""} />
              ))}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** The status line: each new message shows for a few seconds. */
function Feedback() {
  const { feedback } = useSession();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!feedback) return;
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), 2800);
    return () => clearTimeout(timer);
  }, [feedback]);
  return (
    <div id="feedback" role="status" aria-live="polite" className={visible && feedback ? `visible ${feedback.tone}` : ""}>
      {feedback?.message}
    </div>
  );
}

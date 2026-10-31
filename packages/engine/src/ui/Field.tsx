// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { cancelTargeting, fire, pick, select, throwGrenade } from "../actions";
import { distance, weapons, type Encounter, type Unit } from "../game";
import { padActive, padGlyph, padKind, subscribePad } from "../gamepad";
import { pad2 } from "../html";
import { confirmWheel, WHEEL_ACTIONS } from "../pad-combat";
import { timePresets, type TimeOfDay } from "../scene-weather";
import type { Weather } from "../scene/precipitation";
import { damagePreview, grenadeBlockReason, shotBlockReason } from "../targeting";
import { Icon, Logo, type IconName } from "./icons";
import { useSession } from "./useSession";
import { cap, toggleGrid, toggleView } from "./view";
import { DestructionPreview } from "./DestructionPreview";
import { OfficePreview } from "./OfficePreview";

export interface FieldRefs {
  viewport: RefObject<HTMLDivElement | null>;
  labels: RefObject<HTMLDivElement | null>;
  reticle: RefObject<HTMLDivElement | null>;
}

/** The 3D field and everything drawn over it. */
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
      {s.state === "ready" && <ViewTools />}
      <North />
      <Feedback />
      {targeting && <TargetingHud />}
      <div id="aim-reticle" ref={refs.reticle} aria-hidden="true" hidden>
        <i />
        <b />
      </div>
      {s.state === "ready" && <ActionWheel />}
      {s.state === "ready" && <PadHintsBar />}
      <div className="field-bottom">{s.state === "ready" && <SquadCards />}</div>
      {s.state !== "ready" && (
        <div className="loading" id="loading">
          {s.state === "failed" ? (
            <p>3D RENDERER UNAVAILABLE</p>
          ) : (
            <>
              <span>
                <Logo />
              </span>
              <p>BRINGING THE SQUAD IN</p>
            </>
          )}
        </div>
      )}
      {s.state === "ready" && <FieldObjectives />}
    </section>
  );
}

/** "" with no controller; otherwise the pad family, so glyphs re-render on change. */
function usePad(): string {
  return useSyncExternalStore(subscribePad, () => (padActive() ? padKind() : ""));
}

/** Wheel geometry: a square SVG box, filled wedges between the hub and the rim. */
const WHEEL_BOX = 460;
const WHEEL_STEP = 360 / WHEEL_ACTIONS.length;
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

const WEDGES = WHEEL_ACTIONS.map((_, i) => {
  const mid = i * WHEEL_STEP - 90;
  return wedgePath(mid - WHEEL_STEP / 2 + W_GAP, mid + WHEEL_STEP / 2 - W_GAP);
});

/** The selector arc rides outside the rim over wedge 0; a rotation moves it. */
const SELECTOR_ARC = (() => {
  const r = W_OUTER + 9;
  const half = WHEEL_STEP / 2 - W_GAP;
  return `M ${polar(r, -90 - half)} A ${r} ${r} 0 0 1 ${polar(r, -90 + half)}`;
})();

type WheelId = (typeof WHEEL_ACTIONS)[number]["id"];

const WHEEL_ICONS: Record<WheelId, IconName> = {
  fire: "gun",
  grenade: "grenade",
  reload: "reload",
  overwatch: "eye",
  hunker: "shield",
  secure: "extract",
  "end-turn": "hourglass",
};

/** Whether the order would land right now, and the hub's one-line reading of it. */
function wheelStatus(game: Encounter, u: Unit, id: WheelId): { locked: boolean; note: string } {
  if (id === "end-turn") return { locked: false, note: "PASS INITIATIVE" };
  if (!game.canAct(u)) return { locked: true, note: "NO AP" };
  switch (id) {
    case "fire":
      return u.ammo
        ? { locked: false, note: `AMMO ${u.ammo}/${u.clip}` }
        : { locked: true, note: "NO AMMO" };
    case "grenade":
      return u.grenade
        ? { locked: true, note: "EXPENDED" }
        : { locked: false, note: "FRAG · RANGE 5" };
    case "reload":
      return u.ammo === u.clip
        ? { locked: true, note: "MAG FULL" }
        : { locked: false, note: `MAG ${u.ammo}/${u.clip}` };
    case "overwatch":
      return u.ammo ? { locked: false, note: "HOLD FIRE" } : { locked: true, note: "NO AMMO" };
    case "hunker":
      return { locked: false, note: "BRACE · +COVER" };
    case "secure":
      return game.secured
        ? { locked: true, note: "SECURED" }
        : distance(u.pos, game.relay) > 0
          ? { locked: true, note: "NOT ON SITE" }
          : { locked: false, note: "ON SITE" };
  }
}

/** The controller's radial action menu, driven by the pad or the mouse. */
function ActionWheel() {
  const s = useSession();
  /** The selector's unwrapped rotation, so 6 → 0 is one step on, not a lap back. */
  const turned = useRef(0);
  const last = useRef(0);
  if (!s.wheel) return null;
  if (s.wheelIndex !== last.current) {
    const step = (((s.wheelIndex - last.current) * WHEEL_STEP) % 360) + 540;
    turned.current += (step % 360) - 180;
    last.current = s.wheelIndex;
  }
  const u = s.selectedUnit();
  const status = WHEEL_ACTIONS.map((a) => wheelStatus(s.game, u, a.id));
  const focused = status[s.wheelIndex];
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
          {WHEEL_ACTIONS.map((a, i) => (
            <path
              key={a.id}
              className={`wheel-seg ${i === s.wheelIndex ? "focused" : ""} ${status[i].locked ? "locked" : ""}`}
              d={WEDGES[i]}
              onMouseEnter={() => point(i)}
              onClick={() => confirmWheel(i)}
            />
          ))}
          <g className="wheel-selector" style={{ transform: `rotate(${turned.current}deg)` }}>
            <path className="wheel-selector-arc" d={SELECTOR_ARC} />
            <path className="wheel-selector-tick" d={`M ${polar(W_INNER - 8, -90)} l 5 9 h -10 Z`} />
          </g>
        </svg>
        {WHEEL_ACTIONS.map((a, i) => {
          const rad = ((i * WHEEL_STEP - 90) * Math.PI) / 180;
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
              <Icon name={WHEEL_ICONS[a.id]} />
              <span>{a.label}</span>
            </button>
          );
        })}
        <div className="wheel-center" aria-hidden="true">
          <small>{u.name}</small>
          <strong>{WHEEL_ACTIONS[s.wheelIndex].label}</strong>
          <span className={focused.locked ? "locked" : ""}>{focused.note}</span>
          <span className="wheel-ap">
            {[0, 1].map((j) => (
              <i key={j} className={u.ap > j ? "filled" : ""} />
            ))}
          </span>
        </div>
      </div>
    </div>
  );
}

/** The controller hints for the state the field is in; only with a pad connected. */
function PadHintsBar() {
  const pad = usePad();
  const s = useSession();
  if (!pad) return null;
  const hints: [string, string][] = s.wheel
    ? [
        [padGlyph("ls"), "SELECT"],
        [padGlyph("a"), "CONFIRM"],
        [padGlyph("b"), "CLOSE"],
      ]
    : s.mode === "fire"
      ? [
          ["◀ ▶", "TARGET"],
          [padGlyph("a"), "FIRE"],
          [padGlyph("b"), "CANCEL"],
        ]
      : s.mode === "grenade"
        ? [
            [padGlyph("dpad"), "AIM"],
            [padGlyph("a"), "THROW"],
            [padGlyph("b"), "CANCEL"],
          ]
        : [
            [padGlyph("dpad"), "CURSOR"],
            [padGlyph("a"), "MOVE"],
            [padGlyph("y"), "ACTIONS"],
            [`${padGlyph("lb")} ${padGlyph("rb")}`, "OPERATOR"],
            [padGlyph("rt"), "AIM"],
            [padGlyph("b"), "PAUSE"],
          ];
  return (
    <div id="pad-hints" aria-hidden>
      {hints.map(([glyph, label]) => (
        <span key={label}>
          <kbd>{glyph}</kbd>
          {label}
        </span>
      ))}
    </div>
  );
}

function North() {
  const [lat, lon] = useSession().game.scenario.location.coordinates;
  return (
    <div className="north">
      <span>N</span>
      <i />
      <small>
        {lat}
        <br />
        {lon}
      </small>
    </div>
  );
}

function ViewTools() {
  const s = useSession();
  const { battlefield } = s;
  const [time, setTime] = useState<TimeOfDay>(battlefield.timeOfDay);
  const [weather, setWeather] = useState<Weather>(battlefield.weather);
  const [preview, setPreview] = useState(false);
  const [officePreview, setOfficePreview] = useState(false);
  return (
    <>
    <div className="view-tools">
      <details id="scene-controls">
        <summary>SCENE</summary>
        <section aria-label="Scene controls">
          <label htmlFor="scene-time">TIME OF DAY</label>
          <select
            id="scene-time"
            value={time}
            onChange={(e) => {
              const next = e.target.value as TimeOfDay;
              if (!Object.hasOwn(timePresets, next)) return;
              setTime(next);
              battlefield.setTimeOfDay(next);
            }}
          >
            <option value="morning">Morning</option>
            <option value="day">Day</option>
            <option value="evening">Evening</option>
            <option value="night">Night</option>
          </select>
          <label htmlFor="scene-weather">WEATHER</label>
          <select id="scene-weather" value={weather} onChange={(e) => {
            const next = e.target.value as Weather;
            if (next !== "clear" && next !== "rain" && next !== "snow") return;
            setWeather(next);
            battlefield.setWeather(next);
          }}>
            <option value="clear">Clear</option>
            <option value="rain">Rain</option>
            <option value="snow">Snow</option>
          </select>
          <small id="scene-light-status" role="status">
            {battlefield.indoors ? "Office lighting on · ceiling, task & access lights" : `Streetlights ${timePresets[time].lights ? "on" : "off"}`}
          </small>
          <button className="preview-destruction" disabled={s.busy} onClick={() => setPreview(true)}>
            Destruction preview ↗
          </button>
          <button className="preview-destruction" disabled={s.busy} onClick={() => setOfficePreview(true)}>
            Office asset pack ↗
          </button>
        </section>
      </details>
      <button id="view" onClick={toggleView}>
        <Icon name="camera" />
        <span>{battlefield.cinematic ? "CLOSE CAMERA" : "TACTICAL VIEW"}</span>
        <kbd>{cap("camera")}</kbd>
      </button>
      <button
        id="grid"
        className={battlefield.gridVisible ? "active" : ""}
        aria-pressed={battlefield.gridVisible}
        aria-label="Toggle grid"
        onClick={toggleGrid}
      >
        <Icon name="map" />
      </button>
      <button id="focus" aria-label="Focus selected operator" onClick={() => battlefield.focus()}>
        <Icon name="focus" />
      </button>
    </div>
    {preview && <DestructionPreview initialKind={s.battlefield.indoors ? "office-desk" : "crate"} onClose={() => setPreview(false)} />}
    {officePreview && <OfficePreview onClose={() => setOfficePreview(false)} />}
    </>
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

/** The target's health with the slice the shot would remove: the hit, deeper on a crit. */
function HealthPreview({ unit, target, blocked = false }: { unit: Unit; target: Unit; blocked?: boolean }) {
  const { hit, crit, lethal } = damagePreview(unit, target);
  const pct = (n: number) => `${(n / target.maxHp) * 100}%`;
  return (
    <span
      className="target-hp-track"
      role="img"
      aria-label={`${target.name}: ${target.hp} of ${target.maxHp} HP${
        blocked ? "" : `; a hit removes ${hit}${lethal ? ", lethal" : ""}`
      }`}
    >
      <i className="kept" style={{ width: pct(target.hp - (blocked ? 0 : crit)) }} />
      {!blocked && <i className="crit" style={{ width: pct(crit - hit) }} />}
      {!blocked && <i className="hit" style={{ width: pct(hit) }} />}
    </span>
  );
}

const NUDGES: [name: string, glyph: string, x: number, z: number][] = [
  ["north", "↑", 0, -1],
  ["west", "←", -1, 0],
  ["east", "→", 1, 0],
  ["south", "↓", 0, 1],
];

/** The confirmation panel for a shot or a throw. */
function TargetingHud() {
  const s = useSession();
  const { game, busy } = s;
  const u = s.selectedUnit(),
    t = s.targetUnit();
  const cancel = (
    <button id="cancel-target" disabled={busy} onClick={cancelTargeting}>
      CANCEL <kbd>{cap("cancel")}</kbd>
    </button>
  );
  if (s.mode === "fire" && t) {
    const reason = shotBlockReason(game, u, t);
    const preview = damagePreview(u, t);
    return (
      <div id="targeting-hud" aria-label="Target confirmation">
        <div className="targeting-top">
          <span>
            {u.name} / {weapons[u.weapon].label}
          </span>
          {cancel}
        </div>
        <div className="targeting-main">
          <div className="aim-probability">
            {game.chance(u, t)}
            <small>% HIT</small>
          </div>
          <div className="aim-description">
            <small>HOSTILE TARGET</small>
            <strong>{t.name}</strong>
            <span className="target-hp">
              <HealthPreview unit={u} target={t} blocked={!!reason} />
              <small>
                {t.hp}/{t.maxHp} HP · ARMOR {t.armor}
                {!reason && (
                  <>
                    {" "}
                    · HIT −{preview.hit}
                    {preview.crit > preview.hit && ` · CRIT −${preview.crit}`}
                    {preview.lethal && <b className="lethal"> · LETHAL</b>}
                  </>
                )}
              </small>
            </span>
            <span>
              {reason ??
                `${distance(u.pos, t.pos)} TILES · ${u.weapon === "pistol" ? "1 AP" : "ENDS OPERATOR TURN"}`}
            </span>
          </div>
          <button id="confirm-fire" className="primary" disabled={busy || !!reason} onClick={() => void fire()}>
            {busy ? "FIRING…" : "CONFIRM SHOT"} <Icon name="cross" />
          </button>
        </div>
        <div className="target-choices">
          {game.enemies.map((e) => (
            <button
              key={e.id}
              className={e.id === s.target ? "active" : ""}
              disabled={busy}
              onClick={() => select(e.id)}
            >
              {e.name} <b>{distance(u.pos, e.pos) > u.range + 3 ? "OUT OF RANGE" : `${game.chance(u, e)}%`}</b>
            </button>
          ))}
        </div>
      </div>
    );
  }
  if (s.mode !== "grenade") return null;
  const target = s.grenadeTarget;
  const reason = grenadeBlockReason(game, u, target);
  const affected = target ? game.units.filter((a) => a.hp > 0 && distance(a.pos, target) <= 2) : [];
  const friendly = affected.filter((a) => !a.enemy);
  const propDamage = target && !busy ? game.map.blastProps(target) : [];
  const brokenProps = propDamage.filter((p) => p.destroyed).length;
  return (
    <div id="targeting-hud" aria-label="Target confirmation">
      <div className="targeting-top">
        <span>{u.name} / FRAGMENTATION</span>
        {cancel}
      </div>
      <div className="targeting-main">
        <div className="aim-probability">
          {target ? distance(u.pos, target) : "—"}
          <small>/ 5 RANGE</small>
        </div>
        <div className="aim-description">
          <small>GRENADE LANDING POINT</small>
          <strong>{target ? target.join(" : ") : "NO TILE"}</strong>
          <span className={friendly.length ? "friendly-warning" : ""}>
            {reason ??
              (friendly.length
                ? `FRIENDLY FIRE: ${friendly.map((a) => a.name).join(", ")}`
                : `${affected.length} HOSTILES IN BLAST · 2-TILE RADIUS · 1 AP`)}
          </span>
          {!!propDamage.length && (
            <span>{propDamage.length} PROPS HIT · {brokenProps} DESTROYED</span>
          )}
        </div>
        <button id="confirm-grenade" className="primary" disabled={busy || !!reason} onClick={() => void throwGrenade()}>
          {busy ? "THROWING…" : "CONFIRM THROW"} <Icon name="grenade" />
        </button>
      </div>
      <div className="grenade-adjust">
        <span>ADJUST TILE</span>
        {NUDGES.map(([name, glyph, x, z]) => (
          <button
            key={name}
            aria-label={`Aim grenade ${name}`}
            disabled={busy}
            onClick={() => {
              const from = s.grenadeTarget ?? u.pos;
              void pick([from[0] + x, from[1] + z]);
            }}
          >
            {glyph}
          </button>
        ))}
      </div>
    </div>
  );
}

function SquadCards() {
  const s = useSession();
  return (
    <div id="squad-cards">
      {s.game.units
        .filter((a) => !a.enemy)
        .map((a, i) => (
          <button
            key={a.id}
            className={`squad-card ${s.selected === a.id ? "selected" : ""} ${a.hp <= 0 ? "kia" : ""}`}
            disabled={a.hp <= 0}
            onClick={() => select(a.id)}
          >
            <img src={s.portraits.get(a.id)} alt={`${a.name} facial portrait`} />
            <span className="squad-index">{pad2(i + 1)}</span>
            <span className="squad-details">
              <small>{a.role}</small>
              <strong>{a.name}</strong>
              <span className="hp-track">
                <i style={{ width: `${(a.hp / a.maxHp) * 100}%` }} />
              </span>
              <span className="squad-meta">
                {a.hp <= 0 ? "KIA" : a.hunkered ? "HUNKERED" : a.overwatch ? "OVERWATCH" : `${a.hp} / ${a.maxHp} HP`}
                <span className="ap-dots">
                  {[0, 1].map((j) => (
                    <i key={j} className={a.ap > j ? "filled" : ""} />
                  ))}
                </span>
              </span>
            </span>
          </button>
        ))}
    </div>
  );
}

function FieldObjectives() {
  const { game } = useSession();
  const { objectives } = game.scenario;
  const down = game.hostileCount - game.enemies.length;
  return (
    <div id="field-objectives">
      <small>THE CONTRACT</small>
      <p>
        <i className={game.secured ? "done" : ""} />
        {objectives.secure.order}
        {game.secured ? " / SECURED" : ""}
      </p>
      <p>
        <i className={!game.enemies.length ? "done" : ""} />
        {objectives.eliminate.order}{" "}
        <b>
          {down}/{game.hostileCount}
        </b>
      </p>
      <span>
        Turn {pad2(game.turn)} — {game.phase === "player" ? "Ghosts has initiative" : "Hostile activity"}
      </span>
    </div>
  );
}

// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useEffect, useState, type RefObject } from "react";
import { cancelTargeting, fire, pick, select, throwGrenade } from "../actions";
import { distance, weapons } from "../game";
import { pad2 } from "../html";
import { timePresets, type TimeOfDay } from "../scene-weather";
import { grenadeBlockReason, shotBlockReason } from "../targeting";
import { Icon, Logo } from "./icons";
import { useSession } from "./useSession";
import { cap, toggleGrid, toggleView } from "./view";

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
  const [rain, setRain] = useState(true);
  return (
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
          <label className="scene-rain">
            <input
              id="scene-rain"
              type="checkbox"
              checked={rain}
              onChange={(e) => {
                setRain(e.target.checked);
                battlefield.setRain(e.target.checked);
              }}
            />{" "}
            Rain
          </label>
          <small id="scene-light-status" role="status">
            Streetlights {timePresets[time].lights ? "on" : "off"}
          </small>
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
            <span>
              {reason ??
                `${u.damage} DAMAGE · ${distance(u.pos, t.pos)} TILES · ${u.weapon === "pistol" ? "1 AP" : "ENDS OPERATOR TURN"}`}
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

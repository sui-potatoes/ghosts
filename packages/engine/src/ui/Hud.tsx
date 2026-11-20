// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The encounter's chrome, in the menus' interface language: a header strip
 * (turn, clock, objectives, the opponent, view tools, the menu), the squad
 * rail, the selected unit's panel, and the command bar along the bottom edge
 * that IS the command deck. The bar lists exactly the selected unit's actions
 * (the action registry), each with its pictogram, the player's own key or pad
 * glyph, its cost and uses; a refused one stays in place, dimmed, and the hint
 * line says why. While aiming, the bar holds the aim and Confirm / Cancel.
 *
 * Everything here renders from the session store (`changed()`), never per
 * frame; the turn clock ticks in its own component.
 */

import { lazy, Suspense, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  actionDescription,
  commandsOf,
  costLabel,
  GRENADE_RADIUS,
  GRENADE_RANGE,
  isThrowOrder,
  MAX_RANGE_OFFSET,
  REFUSAL_TEXT,
  THROW_EFFECT,
  type CommandState,
  type ThrowOrder,
} from "../action-registry";
import { action, cancelTargeting, deselect, endTurn, fire, pick, select, throwGrenade } from "../actions";
import { runCombatAction } from "../controls";
import { distance, weaponName, type Unit, type UnitOrder } from "../game";
import { padActive, padGlyph, padKind, subscribePad, type PadButton } from "../gamepad";
import { pad2 } from "../html";
import type { CombatAction, PadBindable } from "../keys";
import { rosters, standing } from "../observer";
import { sideInPhase } from "../replay/timeline";
import { timePresets, type TimeOfDay } from "../scene-weather";
import type { Weather } from "../scene/precipitation";
import { session } from "../session";
import { engineSettings } from "../settings";
import { effectDetail, effectLines, effectName, unitCombat } from "../status-effects";
import { aimTargets, burstUnits, damagePreview, grenadeBlockReason, shotBlockReason, stepAimTarget } from "../targeting";
import { Icon, type IconName } from "./icons";
import { TargetIntel } from "./intel/IntelLayer";
import { INSPECT_COMMAND, useInspect } from "./intel/store";
import { useSession } from "./useSession";
import { cap } from "./view";

// Development tools: only under the dev server, never in a build (the import is dropped with the branch).
const DEV_TOOLS = import.meta.env.MODE === "development" && import.meta.env.DEV;
const DestructionPreview = DEV_TOOLS
  ? lazy(() => import("./DestructionPreview").then((m) => ({ default: m.DestructionPreview })))
  : null;
const OfficePreview = DEV_TOOLS
  ? lazy(() => import("./OfficePreview").then((m) => ({ default: m.OfficePreview })))
  : null;

// === Glyphs ===

/** "" with no controller in use; otherwise the pad family, so glyphs re-render on a change. */
export function usePad(): string {
  return useSyncExternalStore(subscribePad, () => (padActive() ? padKind() : ""));
}

type PadKey = PadButton | PadBindable | "dpad" | "";

const FACE = new Set(["a", "b", "x", "y"]);
const SHOULDER = new Set(["lb", "rb", "lt", "rt"]);

/**
 * The player's own binding for a command: the key cap from their combat keys,
 * or the pad button while a pad is in use. Nothing when it has none.
 */
export function Glyph({ action, pad }: { action?: CombatAction; pad?: PadKey }) {
  const kind = usePad();
  if (kind) {
    if (!pad) return null;
    const shape = FACE.has(pad) ? "face" : SHOULDER.has(pad) ? "bumper" : "key";
    return (
      <kbd className="hud-glyph" data-shape={shape} data-pad={kind}>
        {padGlyph(pad as PadButton)}
      </kbd>
    );
  }
  const key = action ? cap(action) : "";
  return key ? (
    <kbd className="hud-glyph" data-shape="key">
      {key}
    </kbd>
  ) : null;
}

/** The pad button that arms an order: the bindable ones from the player's record, the rest on the wheel. */
function padFor(order: UnitOrder | undefined): PadKey {
  const binds = engineSettings().padCombat();
  if (order === "move") return "a";
  if (order === "fire" || order === "grenade" || order === "reload") return binds[order];
  // One utility slot: the grenade button arms whichever grenade the operator carries.
  if (order && isThrowOrder(order)) return binds.grenade;
  return order ? binds.wheel : "";
}

/** Pips: `filled` of `max`, as squares; `spare` marks the tail (a hit's slice, an empty magazine). */
function Pips({ filled, max, tone }: { filled: number; max: number; tone?: "warn" | "dim" }) {
  const n = Math.max(0, Math.min(max, 16));
  return (
    <span className="hud-pips" data-tone={tone} aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <i key={i} data-on={i < filled || undefined} />
      ))}
    </span>
  );
}

// === Header ===

/** The turn clock: only in a match that has one, ticking in its own component. */
function TurnClock({ deadline }: { deadline: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const left = Math.max(0, Math.ceil((deadline - now) / 1000));
  return (
    <div className="hud-clock" data-tone={left <= 15 ? "warn" : undefined} role="timer" aria-label="Turn time left">
      <small>TURN CLOCK</small>
      <strong>
        {pad2(Math.floor(left / 60))}:{pad2(left % 60)}
      </strong>
    </div>
  );
}

/** The scene's look: time of day and weather; dev builds add the asset labs. */
function SceneMenu() {
  const s = useSession();
  const { battlefield } = s;
  const [time, setTime] = useState<TimeOfDay>(battlefield.timeOfDay);
  const [weather, setWeather] = useState<Weather>(battlefield.weather);
  const [lab, setLab] = useState<"" | "destruction" | "office">("");
  return (
    <>
      <details id="scene-controls" className="hud-scene">
        <summary className="hud-tool" aria-label="Scene">
          <Icon name="sun" />
        </summary>
        <section aria-label="Scene controls">
          <label htmlFor="scene-time">Time of day</label>
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
            <option value="overcast">Overcast</option>
            <option value="evening">Evening</option>
            <option value="night">Night</option>
          </select>
          <label htmlFor="scene-weather">Weather</label>
          <select
            id="scene-weather"
            value={weather}
            onChange={(e) => {
              const next = e.target.value as Weather;
              if (next !== "clear" && next !== "rain" && next !== "snow") return;
              setWeather(next);
              battlefield.setWeather(next);
            }}
          >
            <option value="clear">Clear</option>
            <option value="rain">Rain</option>
            <option value="snow">Snow</option>
          </select>
          {DestructionPreview && (
            <button type="button" disabled={s.busy} onClick={() => setLab("destruction")}>
              Destruction preview (dev)
            </button>
          )}
          {OfficePreview && (
            <button type="button" disabled={s.busy} onClick={() => setLab("office")}>
              Office asset pack (dev)
            </button>
          )}
        </section>
      </details>
      <Suspense fallback={null}>
        {lab === "destruction" && DestructionPreview && (
          <DestructionPreview initialKind={battlefield.indoors ? "office-desk" : "crate"} onClose={() => setLab("")} />
        )}
        {lab === "office" && OfficePreview && <OfficePreview onClose={() => setLab("")} />}
      </Suspense>
    </>
  );
}

/** A view tool: a pictogram button with its glyph; the same `CombatAction` the key runs. */
function Tool({
  icon,
  label,
  command,
  pad,
  pressed,
  disabled,
  onClick,
}: {
  icon: IconName;
  label: string;
  command: CombatAction;
  pad?: PadKey;
  pressed?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className="hud-tool"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick ?? (() => runCombatAction(command))}
    >
      <Icon name={icon} />
      <Glyph action={command} pad={pad} />
    </button>
  );
}

/** The header strip: turn and phase, the clock, objectives, the opponent, view tools, the menu. */
export function HudHeader({ onMenu }: { onMenu?: () => void }) {
  const s = useSession();
  const inspect = useInspect();
  const { game, battlefield, observer } = s;
  if (observer) return <ObserverHeader />;
  const { objectives } = game.scenario;
  const down = game.hostileCount - game.enemies.length;
  const phase =
    game.result === "victory"
      ? "Contract complete"
      : game.result === "defeat"
        ? "Squad lost"
        : game.phase === "enemy"
          ? game.scenario.versus || inspect.opponent
            ? "Opponent's turn"
            : "Hostile turn"
          : "Your turn";
  const binds = engineSettings().padCombat();
  const opponent = inspect.opponent;
  return (
    <header className="hud-header">
      <div className="hud-where">
        <small>{game.scenario.briefing.title}</small>
        <strong>
          Turn {pad2(game.turn)} <span data-tone={game.phase === "enemy" && !game.result ? "warn" : undefined}>{phase}</span>
        </strong>
      </div>
      <div className="hud-centre">
        {game.turnDeadline !== undefined && !game.result && <TurnClock deadline={game.turnDeadline} />}
      </div>
      <div className="hud-right">
        <ul className="hud-objectives" aria-label="Objectives">
          {!game.scenario.versus && !game.scenario.noObjective && (
            <li data-done={game.secured || undefined}>
              <i />
              {objectives.secure.order}
            </li>
          )}
          <li data-done={!game.enemies.length || undefined}>
            <i />
            {objectives.eliminate.order}
            <b>
              {down}/{game.hostileCount}
            </b>
          </li>
          {opponent && (
            <li className="hud-opponent">
              VS {opponent.name ?? "Unnamed"} · rating <b>{opponent.rating}</b>
            </li>
          )}
        </ul>
        <div className="hud-tools">
          <SceneMenu />
          <Tool
            icon="camera"
            label={battlefield.cinematic ? "Tactical view" : "Close camera"}
            command="camera"
            pressed={battlefield.cinematic}
          />
          <Tool icon="map" label="Tactical grid" command="grid" pad={binds.grid} pressed={battlefield.gridVisible} />
          <Tool icon="focus" label="Focus operator" command="focus" pad={binds.focus} disabled={!s.selected} />
          <Tool icon="scan" label="Inspect unit" command={INSPECT_COMMAND.action} pad={INSPECT_COMMAND.pad} />
          {onMenu && (
            <button type="button" className="hud-tool hud-menu" aria-label="Menu" title="Menu" onClick={onMenu}>
              <Icon name="menu" />
              <Glyph action="cancel" pad="start" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

/**
 * A viewer's header: the turn and whose it is by name, the live clock when
 * there is one, and both sides with the units each has standing; the view
 * tools as in a game, no menu (the viewer's own controls are the way out).
 */
function ObserverHeader() {
  const s = useSession();
  const { game, battlefield } = s;
  const observer = s.observer!;
  const binds = engineSettings().padCombat();
  const counts = standing(game.units);
  const winner = game.result === "victory" ? 0 : game.result === "defeat" ? 1 : null;
  return (
    <header className="hud-header">
      <div className="hud-where">
        <small>{game.scenario.briefing.title}</small>
        <strong>
          Turn {pad2(observer.turn)}{" "}
          <span>
            {observer.ending ??
              (winner !== null
                ? `${observer.sides[winner].name} won`
                : `${observer.sides[sideInPhase(game)].name} to move`)}
          </span>
        </strong>
      </div>
      <div className="hud-centre">
        {observer.deadline !== undefined && !game.result && <TurnClock deadline={observer.deadline} />}
      </div>
      <div className="hud-right">
        <ul className="hud-objectives" aria-label="Units standing">
          {observer.sides.map((side, i) => (
            <li key={i} data-side={i} data-done={!counts[i].alive || undefined}>
              <i />
              {side.name} standing
              <b>
                {counts[i].alive}/{counts[i].total}
              </b>
            </li>
          ))}
        </ul>
        <div className="hud-tools">
          <SceneMenu />
          <Tool
            icon="camera"
            label={battlefield.cinematic ? "Tactical view" : "Close camera"}
            command="camera"
            pressed={battlefield.cinematic}
          />
          <Tool icon="map" label="Tactical grid" command="grid" pad={binds.grid} pressed={battlefield.gridVisible} />
          <Tool icon="focus" label="Focus unit" command="focus" disabled={!s.selected} />
          <Tool icon="scan" label="Inspect unit" command={INSPECT_COMMAND.action} pad={INSPECT_COMMAND.pad} />
        </div>
      </div>
    </header>
  );
}

// === Squad rail and unit panel ===

/** The squad, one tile each: select by click, tap, number key or the bumpers. */
export function SquadRail() {
  const s = useSession();
  const pad = usePad();
  if (s.observer) {
    const sides = rosters(s.game.units);
    return (
      <>
        {sides.map((units, side) => (
          <nav key={side} className="hud-squad" data-side={side} aria-label={s.observer!.sides[side].name}>
            <small className="hud-squad-name">{s.observer!.sides[side].name}</small>
            {units.map((a) => (
              <button
                type="button"
                key={a.id}
                className="hud-member"
                data-selected={s.selected === a.id || undefined}
                data-kia={a.hp <= 0 || undefined}
                data-enemy={a.enemy || undefined}
                disabled={a.hp <= 0}
                aria-pressed={s.selected === a.id}
                onClick={() => (s.selected === a.id ? deselect() : select(a.id))}
              >
                <img src={s.portraits.get(a.id)} alt="" />
                <span className="hud-member-text">
                  <strong>{a.name}</strong>
                  <span className="hud-bar-track">
                    <i style={{ width: `${(a.hp / a.maxHp) * 100}%` }} />
                  </span>
                </span>
                <Pips filled={a.ap} max={2} />
              </button>
            ))}
          </nav>
        ))}
      </>
    );
  }
  return (
    <nav className="hud-squad" aria-label="Squad">
      {s.game.units
        .filter((a) => !a.enemy)
        .map((a, i) => (
          <button
            type="button"
            key={a.id}
            className="hud-member"
            data-selected={s.selected === a.id || undefined}
            data-kia={a.hp <= 0 || undefined}
            disabled={a.hp <= 0}
            aria-pressed={s.selected === a.id}
            onClick={() => (s.selected === a.id ? deselect() : select(a.id))}
          >
            <img src={s.portraits.get(a.id)} alt="" />
            <span className="hud-member-text">
              <strong>{a.name}</strong>
              <span className="hud-bar-track">
                <i style={{ width: `${(a.hp / a.maxHp) * 100}%` }} />
              </span>
            </span>
            <Pips filled={a.ap} max={2} />
            {!pad && i < 9 && <kbd className="hud-glyph hud-member-key">{i + 1}</kbd>}
          </button>
        ))}
    </nav>
  );
}

/** The selected unit: identity, condition as pips, loadout, effective stats and its status line. */
export function UnitPanel() {
  const s = useSession();
  const u = s.selectedUnit();
  if (!u) return null;
  const effects = effectLines(u.effects);
  const stats = unitCombat(u);
  const changed = (k: keyof typeof stats, base: number) => (stats[k] !== base ? (stats[k] > base ? "up" : "down") : undefined);
  const armed = u.actions.some((a) => a.kind === "Attack");
  return (
    <section className="hud-unit" aria-label={`${u.name}, selected`}>
      <img src={s.portraits.get(u.id)} alt="" />
      <div className="hud-unit-body">
        <div className="hud-unit-name">
          <strong>{u.name}</strong>
          <small>{u.role}</small>
        </div>
        <dl className="hud-unit-condition">
          <div>
            <dt>HP</dt>
            <dd>
              <Pips filled={u.hp} max={u.maxHp} tone={u.hp <= u.maxHp / 3 ? "warn" : undefined} />
              <span>
                {u.hp}/{u.maxHp}
              </span>
            </dd>
          </div>
          <div>
            <dt>AP</dt>
            <dd>
              <Pips filled={u.ap} max={2} />
            </dd>
          </div>
          {armed && (
            <div>
              <dt>Ammo</dt>
              <dd>
                <Pips filled={u.ammo} max={u.clip} tone={u.ammo ? undefined : "warn"} />
              </dd>
            </div>
          )}
        </dl>
        <p className="hud-unit-stats">
          <span>{armed ? weaponName(u) : "Unarmed"}</span>
          <span data-shift={changed("aim", u.aim)}>AIM {stats.aim}</span>
          {(u.defense > 0 || stats.defense !== u.defense) && (
            <span data-shift={changed("defense", u.defense)}>DEF {stats.defense}</span>
          )}
          <span data-shift={changed("mobility", u.mobility)}>MOB {stats.mobility}</span>
          <span data-shift={changed("armor", u.armor)}>ARM {stats.armor}</span>
        </p>
        {effects.length > 0 && (
          <ul className="hud-effects" aria-label="Status effects">
            {effects.map((e) => (
              <li key={e.kind} title={e.description} data-effect={e.kind}>
                <Icon name={e.icon ?? "unknown"} />
                <span>
                  {e.name}
                  {e.detail ? `: ${e.detail}` : ""}
                </span>
                <b>
                  {e.turns} turn{e.turns === 1 ? "" : "s"} left
                </b>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

// === Command bar ===

/** One command slot: pictogram, name, glyph, cost and uses; armed or refused. */
function CommandSlot({
  command,
  armed,
  locked,
  onHint,
}: {
  command: CommandState;
  armed: boolean;
  locked: boolean;
  onHint(kind: string | null): void;
}) {
  const { spec, refusal, uses } = command;
  const run = () => {
    if (locked) return;
    if (!spec) {
      session.notify(REFUSAL_TEXT.unsupported.toUpperCase(), "miss");
      return;
    }
    void action(spec.order);
  };
  return (
    <button
      type="button"
      className="hud-cmd"
      data-kind={command.kind}
      data-armed={armed || undefined}
      data-denied={refusal ? refusal : undefined}
      aria-disabled={!!refusal || locked || undefined}
      aria-pressed={armed}
      onPointerEnter={() => onHint(command.kind)}
      onPointerLeave={() => onHint(null)}
      onFocus={() => onHint(command.kind)}
      onBlur={() => onHint(null)}
      onClick={run}
    >
      <span className="hud-cmd-head">
        <Icon name={spec?.icon ?? "unknown"} />
        <span className="hud-cmd-name">{command.name}</span>
      </span>
      <span className="hud-cmd-meta">
        <Glyph action={spec?.key} pad={padFor(spec?.order)} />
        <small>{costLabel(spec)}</small>
        {uses !== null && (
          <span className="hud-uses" aria-label={`${uses} left`}>
            ×{uses}
          </span>
        )}
      </span>
    </button>
  );
}

/** A command on the bar that is not a unit's action: confirm, cancel, a target step. */
function BarCommand({
  label,
  glyph,
  pad,
  tone,
  disabled,
  icon,
  onClick,
}: {
  label: string;
  glyph?: CombatAction;
  pad?: PadKey;
  tone?: "primary" | "danger";
  disabled?: boolean;
  icon?: IconName;
  onClick(): void;
}) {
  return (
    <button type="button" className="hud-bar-cmd" data-tone={tone} disabled={disabled} onClick={onClick}>
      <Glyph action={glyph} pad={pad} />
      {icon && <Icon name={icon} />}
      <span>{label}</span>
    </button>
  );
}

/** What the bar says while a shot is aimed. */
function AimShot({ u, t }: { u: Unit; t: Unit | undefined }) {
  const s = useSession();
  const { game } = s;
  if (!t) return <p className="hud-hint" data-deny>No hostile in sight</p>;
  const reason = shotBlockReason(game, u, t);
  const preview = damagePreview(u, t);
  const tiles = distance(u.pos, t.pos);
  // What the status effects on either side do to these odds (already in them).
  const notes = [
    ...u.effects.filter((e) => e.turns > 0).map((e) => `${effectName(e.kind)}: ${effectDetail(e.kind)}`),
    ...t.effects.filter((e) => e.turns > 0).map((e) => `Target ${effectName(e.kind).toLowerCase()}: ${effectDetail(e.kind)}`),
  ];
  return (
    <div className="hud-aim">
      <strong className="hud-aim-odds">
        {reason ? "—" : game.chance(u, t)}
        <small>%</small>
      </strong>
      <div className="hud-aim-text">
        <span className="hud-aim-target">
          {t.name}
          <small>
            {t.hp}/{t.maxHp} HP · {tiles} TILES{tiles > u.range ? ` · RANGE ${u.range}+${MAX_RANGE_OFFSET}` : ""}
          </small>
        </span>
        {reason ? (
          <span className="hud-hint" data-deny>
            <i className="hud-warn-mark" />
            {reason}
          </span>
        ) : (
          <span className="hud-hint">
            HIT −{preview.hit}
            {preview.crit > preview.hit && ` · CRIT −${preview.crit}`}
            {preview.lethal && <b> · LETHAL</b>}
            {" · ALL AP"}
          </span>
        )}
        {notes.length > 0 && (
          <span className="hud-hint" data-effects>
            {notes.join(" · ")}
          </span>
        )}
      </div>
      <div className="hud-aim-intel">
        <TargetIntel />
      </div>
    </div>
  );
}

/** What each throw does to whoever its burst catches, for the bar. */
const THROW_VERB: Record<ThrowOrder, string> = { grenade: "Hits", flashbang: "Dazes", "smoke-grenade": "Smokes" };

/** What the bar says while a throw is aimed: the frag's blast, or the burst of a flashbang or a smoke grenade. */
function AimThrow({ u, kind }: { u: Unit; kind: ThrowOrder }) {
  const s = useSession();
  const { game, busy } = s;
  const target = s.grenadeTarget;
  // While the throw plays its use is already spent: no refusal to show.
  const reason = busy ? null : grenadeBlockReason(game, u, target, kind);
  const affected = burstUnits(game, target);
  const friendly = affected.filter((a) => a.enemy === u.enemy);
  const effect = THROW_EFFECT[kind];
  const props = target && !busy && kind === "grenade" ? game.map.blastProps(target) : [];
  if (effect)
    return (
      <div className="hud-aim">
        <strong className="hud-aim-odds">
          {target ? distance(u.pos, target) : "—"}
          <small>/{GRENADE_RANGE}</small>
        </strong>
        <div className="hud-aim-text">
          <span className="hud-aim-target">
            Landing tile
            <small>
              {affected.length - friendly.length} HOSTILE · {friendly.length} SQUAD · {GRENADE_RADIUS}-TILE BURST
            </small>
          </span>
          {reason ? (
            <span className="hud-hint" data-deny>
              <i className="hud-warn-mark" />
              {reason}
            </span>
          ) : affected.length ? (
            <span className="hud-hint" data-deny={(effect === "Daze" && friendly.length > 0) || undefined}>
              {effect === "Daze" && friendly.length > 0 && <i className="hud-warn-mark" />}
              {THROW_VERB[kind]} {affected.map((a) => a.name).join(", ")}: {effectDetail(effect)}
            </span>
          ) : (
            <span className="hud-hint">Nobody in the burst</span>
          )}
        </div>
      </div>
    );
  return (
    <div className="hud-aim">
      <strong className="hud-aim-odds">
        {target ? distance(u.pos, target) : "—"}
        <small>/{GRENADE_RANGE}</small>
      </strong>
      <div className="hud-aim-text">
        <span className="hud-aim-target">
          Landing tile
          <small>
            {affected.length - friendly.length} HOSTILE · {GRENADE_RADIUS}-TILE BLAST
            {props.length ? ` · ${props.length} PROPS HIT` : ""}
          </small>
        </span>
        {reason ? (
          <span className="hud-hint" data-deny>
            <i className="hud-warn-mark" />
            {reason}
          </span>
        ) : friendly.length ? (
          <span className="hud-hint" data-deny>
            <i className="hud-warn-mark" />
            Friendly fire: {friendly.map((a) => a.name).join(", ")}
          </span>
        ) : (
          <span className="hud-hint">Throw lands where the marker is</span>
        )}
      </div>
    </div>
  );
}

const NUDGES: [label: string, icon: string, x: number, z: number][] = [
  ["north", "↑", 0, -1],
  ["west", "←", -1, 0],
  ["east", "→", 1, 0],
  ["south", "↓", 0, 1],
];

/** The command bar along the bottom edge: the selected unit's actions, or the aim. */
export function CommandBar() {
  const s = useSession();
  const pad = usePad();
  const [hovered, setHovered] = useState<string | null>(null);
  const { game, busy } = s;
  const u = s.selectedUnit();
  const myTurn = !game.result && game.phase === "player";
  const aiming = !!u && myTurn && (s.mode === "fire" || isThrowOrder(s.mode));
  const commands = u ? commandsOf(game, u) : [];
  const hoveredCommand = commands.find((c) => c.kind === hovered);
  const locked = busy || s.resolving;

  let context: ReactNode;
  if (aiming && s.mode === "fire") context = <AimShot u={u!} t={s.targetUnit()} />;
  else if (aiming && isThrowOrder(s.mode)) context = <AimThrow u={u!} kind={s.mode} />;
  else if (hoveredCommand) {
    context = hoveredCommand.refusal ? (
      <p className="hud-hint" data-deny>
        <i className="hud-warn-mark" />
        {hoveredCommand.name}: {REFUSAL_TEXT[hoveredCommand.refusal]}
      </p>
    ) : (
      <p className="hud-hint">{actionDescription(hoveredCommand.kind)}</p>
    );
  } else {
    const line = game.result
      ? "The encounter is over"
      : !myTurn
        ? game.scenario.versus
          ? game.turn === 1
            ? "The opponent moves first: your turn comes after theirs"
            : "The opponent is moving"
          : "Hostiles are moving"
        : s.resolving
          ? "Order sent"
          : busy
            ? "Executing"
            : !u
              ? pad
                ? "Pick an operator"
                : "Pick an operator: click one, or press their number"
              : u.ap <= 0
                ? `${u.name} has no action points left`
                : s.mode === "move" && commands.some((c) => c.kind === "Move" && !c.refusal)
                  ? "Pick a tile, or an order"
                  : "Pick an order";
    context = <p className="hud-hint">{line}</p>;
  }

  return (
    <footer className="hud-bar" aria-label="Commands">
      <div className="hud-bar-context">
        <small className="hud-bar-title">
          {u ? `${u.name} · ${u.ap} AP` : "Squad"}
          {aiming && (s.mode === "fire" ? " · Aiming" : " · Throwing")}
        </small>
        {context}
      </div>
      <div className="hud-bar-commands">
        {aiming ? (
          <>
            {s.mode === "fire" ? (
              <>
                <BarCommand
                  label="Prev"
                  icon="chevron"
                  pad="dpad"
                  disabled={busy || aimTargets(game, u!).length < 2}
                  onClick={() => stepTarget(-1)}
                />
                <BarCommand
                  label="Next"
                  icon="chevron"
                  pad="dpad"
                  disabled={busy || aimTargets(game, u!).length < 2}
                  onClick={() => stepTarget(1)}
                />
              </>
            ) : (
              <span className="hud-nudges" role="group" aria-label="Adjust landing tile">
                {NUDGES.map(([name, glyph, x, z]) => (
                  <button
                    type="button"
                    key={name}
                    aria-label={`Aim ${name}`}
                    disabled={busy}
                    onClick={() => {
                      const from = s.grenadeTarget ?? u!.pos;
                      void pick([from[0] + x, from[1] + z]);
                    }}
                  >
                    {glyph}
                  </button>
                ))}
              </span>
            )}
            <span className="hud-bar-rule" />
            <BarCommand label="Cancel" glyph="cancel" pad="b" disabled={busy} onClick={cancelTargeting} />
            <BarCommand
              label={s.mode === "fire" ? (busy ? "Firing" : "Fire") : busy ? "Throwing" : "Throw"}
              glyph="confirm"
              pad="a"
              tone="primary"
              disabled={
                busy ||
                (s.mode === "fire"
                  ? !!shotBlockReason(game, u!, s.targetUnit())
                  : !!grenadeBlockReason(game, u!, s.grenadeTarget, isThrowOrder(s.mode) ? s.mode : "grenade"))
              }
              onClick={() => void (s.mode === "fire" ? fire() : throwGrenade())}
            />
          </>
        ) : (
          commands.map((c) => (
            <CommandSlot
              key={c.kind}
              command={c}
              armed={!!c.spec && c.spec.order === s.mode && !c.refusal && myTurn}
              locked={locked}
              onHint={setHovered}
            />
          ))
        )}
      </div>
      <div className="hud-end">
        <button
          type="button"
          className="hud-end-turn"
          disabled={busy || !!game.result || game.phase !== "player"}
          onClick={() => void endTurn()}
        >
          <Glyph action={aiming ? undefined : "confirm"} pad={engineSettings().padCombat().wheel} />
          <span>{!game.result && game.phase !== "player" && game.scenario.versus ? "Opponent's turn" : "End turn"}</span>
        </button>
      </div>
    </footer>
  );
}

/** Walk the aim to the next or previous hostile, as the pad's d-pad does. */
function stepTarget(dir: 1 | -1) {
  const u = session.selectedUnit();
  const next = u && stepAimTarget(session.game, u, session.target, dir);
  if (next) select(next.id);
}

// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useEffect, useRef, useState } from "react";
import { audio } from "../audio";
import { showBriefing } from "../actions";
import { boot } from "../boot";
import type { Recruit } from "@ghosts/squad/types";
import type { DriverFactory } from "../driver";
import type { Scenario } from "../scenario";
import { Playback, type PlaybackState } from "../replay/playback";
import { sceneStage } from "../replay/stage";
import type { ObserverCard, ObserverEnding } from "../observer";
import type { RecordSource } from "../replay/timeline";
export type { ObserverCard, ObserverEnding } from "../observer";
import { newSession, type Session } from "../session";
import { defaultSettings, type EngineSettings } from "../settings";
import type { EncounterDebrief } from "../aftermath/report";
import { Briefing, Debrief } from "./Dialogs";
import type { Guide } from "../guide/run";
import { GuideLayer } from "./Guide";
import { LayoutPanel } from "./LayoutPanel";
import { Field, type FieldRefs } from "./Field";
import { CommandBar, HudHeader, SquadRail, UnitPanel } from "./Hud";
import { useSession } from "./useSession";
import type { IntelSource, OpponentIntel } from "../intel";
import { inspect } from "./intel/store";
import "../host-reset.css";
import "../tokens.css";
import "../style.css";

export interface EncounterProps {
  /** What to play; Operation Black Rain when omitted. */
  scenario?: Scenario;
  /** What decides orders: the bundled rules when omitted, the host's chain driver later. */
  driver?: DriverFactory;
  /** The player's recruits in squad order (faces, names, armor); the showcase squad when omitted. */
  squad?: readonly Recruit[] | null;
  /** The player's preferences, read live. */
  settings?: EngineSettings;
  /** Freeze the field, rigs, rain and audio (the host's pause menu is up). */
  paused?: boolean;
  /** Cancel with nothing to cancel: open the host's pause menu. */
  onPause?: () => void;
  /** Back to the host's menu from the debrief. */
  onQuit?: () => void;
  /**
   * The host shows the end of an encounter itself: called once with the report
   * when the debrief would open, instead of the engine's own dialog. The field
   * stays behind it; the host ends the debrief with `closeEncounterDebrief`
   * (back to the field) or `restartEncounter`.
   */
  onDebrief?: (debrief: EncounterDebrief) => void;
  /** What the host knows about units (names, rank, gear) over the engine's own reading; read live. */
  intel?: IntelSource;
  /** The opposing player in a match: the hostile readout's commander line. */
  opponent?: OpponentIntel | null;
  /**
   * Mount with no seat, to watch a game: no orders, both squads as equals, the
   * camera free. The field plays `source` through a `Playback` handed to the
   * host once it is up; the host draws the controls. `scenario` and `driver`
   * are not used.
   */
  observer?: ObserverOptions;
  /**
   * A guided run over the encounter (`guide/`, e.g. Basics' `basicsTraining`):
   * its card and pointers over the field, and its say over which orders go
   * ahead. Pass the guided driver with it. Absent: nothing is guided.
   */
  guide?: Guide;
}

export interface ObserverOptions {
  source: RecordSource;
  /** Open on the game's first event (default) or at its live edge. */
  start?: "start" | "live";
  /** The transport, once the field is ready; disposed with the encounter. */
  onPlayback?: (playback: Playback) => void;
  /**
   * A card over the field, in the briefing's place and look: read live each time it opens.
   * With `hold`, the encounter opens on it, paused on the first position with no event
   * applied, and Play (`onPlay`) is what starts the playback; Exit and Escape call `onExit`.
   * Opened again later (`openMatchCard`) it only has Back. `onCardClose` hears every close.
   */
  card?: () => ObserverCard;
  /** The match's ending for the playback as it stands (null while it goes on): the header and the status line show it. */
  ending?: (state: PlaybackState) => ObserverEnding | null;
  hold?: boolean;
  onPlay?: () => void;
  onExit?: () => void;
  onCardClose?: () => void;
}

/** Start the viewer's playback on a session whose field is up. Returns the teardown. */
function startPlayback(session: Session, options: ObserverOptions): () => void {
  const stage = sceneStage(options.source);
  const playback = new Playback(options.source, stage, stage.firstSide, stage.firstRound);
  // The live game's clock shows while the viewer follows it.
  let announced = false;
  const clock = () => {
    const state = playback.getState();
    const deadline = state.live ? options.source.deadline?.() : undefined;
    const ending = options.ending?.(state) ?? null;
    const view = session.observer;
    if (!view) return;
    if (view.deadline !== deadline || (view.ending ?? null) !== (ending?.header ?? null)) {
      view.deadline = deadline;
      view.ending = ending?.header ?? null;
      session.changed();
    }
    // The last beat: the status line once the last event has played out (not over its turn line).
    if (!ending) announced = false;
    else if (!announced && !state.playing) {
      announced = true;
      if (ending.status) session.notify(ending.status);
    }
  };
  const unsubscribe = playback.subscribe(clock);
  playback.start({ at: options.start, paused: options.hold });
  options.onPlayback?.(playback);
  if (options.hold && options.card) showBriefing("replay");
  return () => {
    unsubscribe();
    playback.dispose();
  };
}

/**
 * A playable encounter. Mount it to start one, unmount it to end it: the
 * renderer, audio and listeners go with it. One encounter runs at a time.
 * Restarting and reopening the briefing are `restartEncounter` and
 * `openBriefing` from the engine's entry point.
 */
export function Encounter({
  scenario,
  driver,
  squad = null,
  settings = defaultSettings,
  paused = false,
  onPause,
  onQuit,
  onDebrief,
  intel,
  opponent = null,
  observer,
  guide,
}: EncounterProps) {
  const refs: FieldRefs = {
    viewport: useRef<HTMLDivElement>(null),
    labels: useRef<HTMLDivElement>(null),
    reticle: useRef<HTMLDivElement>(null),
  };
  // The session exists before the first render so the UI subscribes to the one boot fills in.
  const [session] = useState(() => {
    const s = observer
      ? newSession(observer.source.scenario, undefined, { sides: observer.source.sides, turn: 1, host: observer })
      : newSession(scenario, driver);
    // Guided run touch point: the field's actions ask the guide before an order goes ahead.
    if (guide && !observer) s.guide = guide;
    return s;
  });
  const hooks = useRef({ onPause, onQuit, onDebrief });
  hooks.current = { onPause, onQuit, onDebrief };
  const watching = useRef(observer);
  inspect.source = intel;
  useEffect(() => {
    inspect.opponent = opponent;
    inspect.changed();
  }, [opponent]);

  useEffect(() => {
    let stop: (() => void) | undefined;
    const teardown = boot({
      session,
      squad,
      settings,
      viewport: refs.viewport.current!,
      labels: refs.labels.current!,
      reticle: refs.reticle.current!,
      onPause: () => {
        if (!hooks.current.onPause) return;
        // Gate input now: the host's `paused` prop lands in a passive
        // effect, which a busy frame defers past the menu's first paint —
        // a pad or key pressed in that window must not reach the field.
        session.paused = true;
        hooks.current.onPause();
      },
      onReady: () => {
        if (watching.current) stop = startPlayback(session, watching.current);
      },
    });
    return () => {
      stop?.();
      teardown();
    };
    // The encounter is built once per mount; a new scenario or settings source means a new mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    session.paused = paused;
    audio.setPaused(paused);
    session.battlefield?.setPaused(paused);
  }, [session, paused]);

  // The header's menu button: the same way out as Cancel with nothing to cancel, for touch.
  const menu = onPause
    ? () => {
        session.paused = true;
        hooks.current.onPause?.();
      }
    : undefined;

  return <EncounterView observer={!!observer} refs={refs} onQuit={() => hooks.current.onQuit?.()} hasQuit={!!onQuit} onMenu={menu} onDebrief={onDebrief ? (d) => hooks.current.onDebrief?.(d) : undefined} guide={observer ? undefined : guide} />;
}

function EncounterView({
  observer,
  refs,
  onQuit,
  hasQuit,
  onMenu,
  onDebrief,
  guide,
}: {
  observer: boolean;
  refs: FieldRefs;
  onQuit: () => void;
  hasQuit: boolean;
  onMenu?: () => void;
  onDebrief?: (debrief: EncounterDebrief) => void;
  guide?: Guide;
}) {
  const s = useSession();
  const ready = s.state === "ready";
  return (
    <div className="encounter" data-observer={observer || undefined}>
      <main className="workspace">
        <Field refs={refs} />
        {ready && <HudHeader onMenu={onMenu} />}
        {ready && <SquadRail />}
        {ready && <UnitPanel />}
        {ready && !observer && <CommandBar />}
        {ready && !observer && <LayoutPanel />}
        {guide && <GuideLayer guide={guide} />}
      </main>
      {ready &&
        (s.debrief ? (
          <Debrief onQuit={hasQuit ? onQuit : undefined} onDebrief={onDebrief} />
        ) : (
          s.panel && <Briefing panel={s.panel} />
        ))}
    </div>
  );
}

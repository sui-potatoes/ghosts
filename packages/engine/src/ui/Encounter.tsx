// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useEffect, useRef, useState } from "react";
import { audio } from "../audio";
import { boot } from "../boot";
import type { Recruit } from "@ghosts/squad/types";
import type { DriverFactory } from "../driver";
import type { Scenario } from "../scenario";
import { newSession } from "../session";
import { defaultSettings, type EngineSettings } from "../settings";
import type { EncounterDebrief } from "../aftermath/report";
import { Briefing, Debrief } from "./Dialogs";
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
}: EncounterProps) {
  const refs: FieldRefs = {
    viewport: useRef<HTMLDivElement>(null),
    labels: useRef<HTMLDivElement>(null),
    reticle: useRef<HTMLDivElement>(null),
  };
  // The session exists before the first render so the UI subscribes to the one boot fills in.
  const [session] = useState(() => newSession(scenario, driver));
  const hooks = useRef({ onPause, onQuit, onDebrief });
  hooks.current = { onPause, onQuit, onDebrief };
  inspect.source = intel;
  useEffect(() => {
    inspect.opponent = opponent;
    inspect.changed();
  }, [opponent]);

  useEffect(
    () =>
      boot({
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
      }),
    // The encounter is built once per mount; a new scenario or settings source means a new mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

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

  return <EncounterView refs={refs} onQuit={() => hooks.current.onQuit?.()} hasQuit={!!onQuit} onMenu={menu} onDebrief={onDebrief ? (d) => hooks.current.onDebrief?.(d) : undefined} />;
}

function EncounterView({
  refs,
  onQuit,
  hasQuit,
  onMenu,
  onDebrief,
}: {
  refs: FieldRefs;
  onQuit: () => void;
  hasQuit: boolean;
  onMenu?: () => void;
  onDebrief?: (debrief: EncounterDebrief) => void;
}) {
  const s = useSession();
  const ready = s.state === "ready";
  return (
    <div className="encounter">
      <main className="workspace">
        <Field refs={refs} />
        {ready && <HudHeader onMenu={onMenu} />}
        {ready && <SquadRail />}
        {ready && <UnitPanel />}
        {ready && <CommandBar />}
      </main>
      {ready &&
        (s.debrief ? (
          <Debrief onQuit={hasQuit ? onQuit : undefined} onDebrief={onDebrief} />
        ) : (
          s.panel && <Briefing deploy={s.panel === "deploy"} />
        ))}
    </div>
  );
}

// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useEffect, useRef, useState } from "react";
import { audio } from "../audio";
import { boot } from "../boot";
import type { Recruit } from "@ghosts/squad/types";
import type { Scenario } from "../scenario";
import { newSession } from "../session";
import { defaultSettings, type EngineSettings } from "../settings";
import { Briefing, Debrief } from "./Dialogs";
import { Field, type FieldRefs } from "./Field";
import { CommandDeck, IntelPanel } from "./Panels";
import { useSession } from "./useSession";
import "../style.css";
import "../ghosts-theme.css";

export interface EncounterProps {
  /** What to play; Operation Black Rain when omitted. */
  scenario?: Scenario;
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
}

/**
 * A playable encounter. Mount it to start one, unmount it to end it: the
 * renderer, audio and listeners go with it. One encounter runs at a time.
 * Restarting and reopening the briefing are `restartEncounter` and
 * `openBriefing` from the engine's entry point.
 */
export function Encounter({
  scenario,
  squad = null,
  settings = defaultSettings,
  paused = false,
  onPause,
  onQuit,
}: EncounterProps) {
  const refs: FieldRefs = {
    viewport: useRef<HTMLDivElement>(null),
    labels: useRef<HTMLDivElement>(null),
    reticle: useRef<HTMLDivElement>(null),
  };
  // The session exists before the first render so the UI subscribes to the one boot fills in.
  const [session] = useState(() => newSession(scenario));
  const hooks = useRef({ onPause, onQuit });
  hooks.current = { onPause, onQuit };

  useEffect(
    () =>
      boot({
        session,
        squad,
        settings,
        viewport: refs.viewport.current!,
        labels: refs.labels.current!,
        reticle: refs.reticle.current!,
        onPause: () => hooks.current.onPause?.(),
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

  return <EncounterView refs={refs} onQuit={() => hooks.current.onQuit?.()} hasQuit={!!onQuit} />;
}

function EncounterView({ refs, onQuit, hasQuit }: { refs: FieldRefs; onQuit: () => void; hasQuit: boolean }) {
  const s = useSession();
  const ready = s.state === "ready";
  return (
    <div className="encounter">
      <main className="workspace">
        <Field refs={refs} />
        {ready && <IntelPanel />}
        {ready && <CommandDeck />}
      </main>
      {ready &&
        (s.debrief ? (
          <Debrief onQuit={hasQuit ? onQuit : undefined} />
        ) : (
          s.panel && <Briefing deploy={s.panel === "deploy"} />
        ))}
    </div>
  );
}

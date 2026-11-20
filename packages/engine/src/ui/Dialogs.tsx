// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { Fragment, useCallback, useEffect, useRef } from "react";
import { closeBriefing, closeDebrief, reset } from "../actions";
import { encounterReport, type EncounterDebrief } from "../aftermath/report";
import { revealEncounter } from "../aftermath/reveal";
import { weaponName } from "../game";
import type { Panel } from "../session";
import { pad2 } from "../html";
import { lookSetting } from "../scene-look";
import { Glyph } from "./Hud";
import { useSession } from "./useSession";

/** Scenario copy marks order names as `*word*`. */
function Emphasis({ text }: { text: string }) {
  return (
    <>
      {text.split(/\*([^*]+)\*/).map((part, i) => (i % 2 ? <b key={i}>{part}</b> : <Fragment key={i}>{part}</Fragment>))}
    </>
  );
}

/** A native modal dialog that is open while mounted and reports its own close. */
function useModal(onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    if (!dialog.open) dialog.showModal();
    const close = () => onClose();
    dialog.addEventListener("close", close);
    return () => {
      dialog.removeEventListener("close", close);
      if (dialog.open) dialog.close();
    };
  }, [onClose]);
  return ref;
}

/** The briefing: contract and rules of engagement; on deployment also the squad and Deploy. */
export function Briefing({ panel }: { panel: Panel }) {
  const s = useSession();
  if (s.observer && (panel === "replay" || panel === "match")) return <ObserverBriefing replay={panel === "replay"} />;
  return <FieldBriefing deploy={panel === "deploy"} />;
}

/** A viewer's card, in the briefing's frame: who played, what for, how it ended; Play and Exit before a replay, else Back. */
function ObserverBriefing({ replay }: { replay: boolean }) {
  const s = useSession();
  const host = s.observer?.host;
  const played = useRef(false);
  const ref = useModal(
    useCallback(() => {
      // Play started the match; any other close of the first card is Exit.
      closeBriefing();
      if (replay && !played.current) host?.onExit?.();
      host?.onCardClose?.();
    }, [host, replay]),
  );
  const go = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (replay) go.current?.focus();
  }, [replay]);
  const card = host?.card?.();
  if (!card) return null;
  return (
    <dialog
      id="modal"
      ref={ref}
      className="hud-prompt briefing-modal"
      aria-labelledby="briefing-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) ref.current?.close();
      }}
    >
      <small className="hud-prompt-eyebrow">{card.eyebrow}</small>
      <h2 className="hud-prompt-title" id="briefing-title">
        {card.title}
      </h2>
      {card.line && <p className="hud-prompt-body">{card.line}</p>}
      <dl className="hud-prompt-lines">
        {card.facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="hud-prompt-commands">
        <button type="button" className="hud-bar-cmd" onClick={() => ref.current?.close()}>
          <Glyph action="cancel" pad="b" />
          <span>{replay ? "Exit" : "Back"}</span>
        </button>
        {replay && (
          <button
            ref={go}
            type="button"
            className="hud-bar-cmd"
            data-tone="primary"
            onClick={() => {
              played.current = true;
              host?.onPlay?.();
              ref.current?.close();
            }}
          >
            <Glyph action="confirm" pad="a" />
            <span>Play</span>
          </button>
        )}
      </div>
    </dialog>
  );
}

function FieldBriefing({ deploy }: { deploy: boolean }) {
  const s = useSession();
  const ref = useModal(closeBriefing);
  const go = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (deploy) go.current?.focus();
  }, [deploy]);
  const b = s.game.scenario.briefing;
  const allies = s.game.units.filter((u) => !u.enemy);
  return (
    <dialog
      id="modal"
      ref={ref}
      className="hud-prompt briefing-modal"
      aria-labelledby="briefing-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) ref.current?.close();
      }}
    >
      <small className="hud-prompt-eyebrow">{b.issuer}</small>
      <h2 className="hud-prompt-title" id="briefing-title">
        {b.title}
      </h2>
      <p className="hud-prompt-body">{lookSetting(b.setting, b.scene, s.battlefield?.look ?? null)}</p>
      <dl className="hud-prompt-lines">
        {b.facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="hud-prompt-scroll">
        <h3>The contract</h3>
        {b.contract.map((p, i) => (
          <p key={i}>
            <Emphasis text={p} />
          </p>
        ))}
        <h3>Rules of engagement</h3>
        <p>
          <Emphasis text={b.rules} />
        </p>
        {deploy && (
          <>
            <h3>
              Deployed squad <span>{pad2(allies.length)}</span>
            </h3>
            <ol className="hud-roster">
              {allies.map((u) => {
                const portrait = s.portraits.get(u.id);
                return (
                  <li key={u.id}>
                    {portrait && <img src={portrait} alt="" />}
                    <div>
                      <b>{u.name}</b>
                      <small>{u.role}</small>
                      <small>{weaponName(u)}</small>
                    </div>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </div>
      <div className="hud-prompt-commands">
        <button type="button" className="hud-bar-cmd" onClick={() => ref.current?.close()}>
          <Glyph action="cancel" pad="b" />
          <span>{deploy ? "Close" : "Back"}</span>
        </button>
        {deploy && (
          <button ref={go} type="button" className="hud-bar-cmd" data-tone="primary" onClick={() => ref.current?.close()}>
            <Glyph action="confirm" pad="a" />
            <span>Deploy squad</span>
          </button>
        )}
      </div>
    </dialog>
  );
}

/** The after-action debrief. Its reveal timeline owns the dialog's content; React only hosts it. */
export function Debrief({ onQuit, onDebrief }: { onQuit?: () => void; onDebrief?: (debrief: EncounterDebrief) => void }) {
  const s = useSession();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const { battlefield, game, portraits } = s;
    // A host that shows the result itself gets the report and no dialog; it ends the
    // debrief with `closeEncounterDebrief` or `restartEncounter`.
    if (onDebrief) {
      onDebrief({ report: encounterReport(game), operation: game.scenario.briefing.title, sector: game.scenario.location.sector });
      return;
    }
    const dialog = ref.current!;
    revealEncounter(dialog, {
      report: encounterReport(game),
      operation: game.scenario.briefing.title,
      sector: game.scenario.location.sector,
      portraits,
      onRedeploy: reset,
      onQuit,
      onClose: () => {
        battlefield.invalidate();
        closeDebrief();
      },
    });
    return () => {
      if (dialog.open) dialog.close();
    };
    // One reveal per debrief; the session object is stable while it is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return onDebrief ? null : <dialog id="modal" ref={ref} />;
}

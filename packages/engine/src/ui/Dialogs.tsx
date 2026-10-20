// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { Fragment, useEffect, useRef } from "react";
import { closeBriefing, closeDebrief, reset } from "../actions";
import { encounterReport } from "../aftermath/report";
import { revealEncounter } from "../aftermath/reveal";
import { weapons } from "../game";
import { pad2 } from "../html";
import { Icon } from "./icons";
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
export function Briefing({ deploy }: { deploy: boolean }) {
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
      className="briefing-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) ref.current?.close();
      }}
    >
      <div id="modal-content">
        <button className="modal-close" aria-label="Close panel" onClick={() => ref.current?.close()}>
          <Icon name="close" />
        </button>
        <div className="modal-heading">
          <div className="eyebrow">{b.issuer}</div>
          <h2>{b.title}</h2>
          <p>{b.setting}</p>
        </div>
        <div className="briefing">
          <div>
            <h3>THE CONTRACT</h3>
            {b.contract.map((p, i) => (
              <p key={i}>
                <Emphasis text={p} />
              </p>
            ))}
            <h3>RULES OF ENGAGEMENT</h3>
            <p>
              <Emphasis text={b.rules} />
            </p>
          </div>
          <div className="briefing-facts">
            {b.facts.map(([label, value]) => (
              <span key={label}>
                {label}
                <b>{value}</b>
              </span>
            ))}
          </div>
        </div>
        {deploy && (
          <>
            <div className="deploy-squad">
              <h3>
                <span>DEPLOYED SQUAD</span>
                <span>{pad2(allies.length)} OPERATIVES</span>
              </h3>
              <ol className="deploy-roster">
                {allies.map((u) => {
                  const portrait = s.portraits.get(u.id);
                  return (
                    <li key={u.id}>
                      {portrait && <img src={portrait} alt="" />}
                      <div>
                        <span>{u.role}</span>
                        <b>{u.name}</b>
                        <small>{u.full}</small>
                        <p>
                          {weapons[u.weapon].label}
                          <br />
                          HP {u.maxHp} · ARMOR {u.armor} · AIM {u.aim}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
            <div className="deploy-actions">
              <button ref={go} type="button" className="deploy-go" onClick={() => ref.current?.close()}>
                DEPLOY SQUAD <span>→</span>
              </button>
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}

/** The after-action debrief. Its reveal timeline owns the dialog's content; React only hosts it. */
export function Debrief({ onQuit }: { onQuit?: () => void }) {
  const s = useSession();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const { battlefield, game, portraits } = s;
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
  return <dialog id="modal" ref={ref} />;
}

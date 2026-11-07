// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useState } from "react";

import { previewVoice } from "../../../audio";
import { nextRankXp } from "../../../chain/match-rules";
import { VOICES, type ChainRecruit } from "../../../chain";
import { ConfirmDialog } from "../../../components/ConfirmDialog";

/**
 * The operative's record: the name drawn at hire (permanent), rank, the voice
 * and dismissal. Picking a voice auditions it with the same line for every
 * voice; the change joins the recruit's unsaved draft and saves with their
 * looks. Dismissal asks first, then lets the recruit go for good — their gear
 * returns to the armory and the slot opens for a free hire.
 */
export function DossierPanel({
    recruit,
    voice,
    busy,
    onVoice,
    onDismiss,
}: {
    recruit: ChainRecruit;
    voice: number;
    busy: boolean;
    onVoice(voice: number): void;
    onDismiss(): void;
}) {
    const [confirming, setConfirming] = useState(false);
    const mods = recruit.weapon?.upgrades.length ?? 0;
    const gear = [
        recruit.weapon &&
            (mods
                ? `${recruit.weapon.name} (with ${mods} mod${mods > 1 ? "s" : ""})`
                : recruit.weapon.name),
        recruit.armor?.name,
    ].filter(Boolean);
    return (
        <div className="dossier-panel">
            <div className="sq-panel-heading">
                <div>
                    <span className="sq-eyebrow">OPERATIVE RECORD</span>
                    <h3>Dossier</h3>
                </div>
                <span className="sq-count">{recruit.rank.$kind}</span>
            </div>
            <dl className="hq-dossier">
                <div>
                    <dt>Name</dt>
                    <dd>
                        {recruit.metadata.name}
                        <small>Fixed on hire</small>
                    </dd>
                </div>
                <div>
                    <dt>Rank</dt>
                    <dd>
                        {recruit.rank.$kind}
                        <small>
                            {nextRankXp(recruit.rank.$kind) === undefined
                                ? `${recruit.xp} XP`
                                : `${recruit.xp} / ${nextRankXp(recruit.rank.$kind)} XP to promotion`}
                        </small>
                    </dd>
                </div>
            </dl>
            <fieldset className="hq-voices">
                <legend className="sq-eyebrow">Voice</legend>
                {VOICES.map((v) => (
                    <button
                        key={v.id}
                        aria-pressed={voice === v.id}
                        disabled={!v.available}
                        onClick={() => {
                            previewVoice(v.id);
                            onVoice(v.id);
                        }}
                    >
                        {v.label}
                        {v.available ? (
                            <span className="hq-voice-play" aria-hidden="true">
                                ▶
                            </span>
                        ) : (
                            <span className="tag">soon</span>
                        )}
                    </button>
                ))}
            </fieldset>
            <div className="personnel-stamp">
                <span>GHOSTS / PERSONNEL</span>
                <strong>ACTIVE</strong>
            </div>
            <div className="hq-dismiss">
                <p>
                    <strong>Dismiss operative</strong>
                    <small>
                        Leaves the squad for good. All of their equipment returns to the armory.
                    </small>
                </p>
                <button className="btn" disabled={busy} onClick={() => setConfirming(true)}>
                    Dismiss
                </button>
            </div>
            <ConfirmDialog
                open={confirming}
                title={`Dismiss ${recruit.metadata.name}`}
                confirmLabel="Dismiss"
                danger
                onConfirm={() => {
                    setConfirming(false);
                    onDismiss();
                }}
                onClose={() => setConfirming(false)}
            >
                {recruit.metadata.name} leaves the squad and will not come back. All of their
                equipment is returned to the armory
                {gear.length > 0 ? `: ${gear.join(" and ")}.` : " (they carry none right now)."} The
                slot opens for a free hire.
            </ConfirmDialog>
        </div>
    );
}

// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { VOICES, type ChainRecruit } from "../../../chain";

const short = (id: string) => `${id.slice(0, 6)}…${id.slice(-4)}`.toUpperCase();

/**
 * The operative's record: the name drawn at hire (permanent), rank, and the
 * voice — the one personnel setting the chain keeps. Voice changes join the
 * recruit's unsaved draft and save with their looks.
 */
export function DossierPanel({
    recruit,
    voice,
    onVoice,
}: {
    recruit: ChainRecruit;
    voice: number;
    onVoice(voice: number): void;
}) {
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
                    <dd>{recruit.rank.$kind}</dd>
                </div>
            </dl>
            <fieldset className="hq-voices">
                <legend className="sq-eyebrow">Voice</legend>
                {VOICES.map((v) => (
                    <button
                        key={v.id}
                        aria-pressed={voice === v.id}
                        disabled={!v.available}
                        onClick={() => onVoice(v.id)}
                    >
                        {v.label}
                        {!v.available && <span className="tag">soon</span>}
                    </button>
                ))}
            </fieldset>
            <div className="personnel-stamp">
                <span>GHOSTS / PERSONNEL</span>
                <strong>ACTIVE</strong>
                <small>ON-CHAIN FILE / {short(recruit.objectId)}</small>
            </div>
        </div>
    );
}

// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Headquarters at `/headquarters`: the player's squad on Sui. Recruitment
 * deals four face-down cards that turn over as the free hires land; from
 * there each operative gets the full squad studio — loadout from the
 * account's armory, stats, the character editor and their dossier. Looks and
 * voice edit as a per-recruit draft and save in one transaction; gear moves
 * immediately. See `src/features/headquarters/README.md`.
 */

import type { Transaction } from "@mysten/sui/transactions";
import { useEffect, useMemo, useState } from "react";

import { encodeVisuals, sameVisuals } from "@ghosts/squad/appearance/codec";
import type { Focus } from "@ghosts/squad/studio/recruit-studio";
import type { Appearance, ArmorColors } from "@ghosts/squad/types";

import {
    createAccountTx,
    editRecruitTx,
    fetchAccountId,
    FREE_RECRUITS,
    hireRecruitsTx,
    type Step,
} from "../chain";
import { PadHints } from "../components/PadHints";
import { DossierPanel } from "../features/headquarters/components/DossierPanel";
import { HireDeck } from "../features/headquarters/components/HireDeck";
import { LoadoutPanel } from "../features/headquarters/components/LoadoutPanel";
import { RecruitCard } from "../features/headquarters/components/RecruitCard";
import { TxOverlay } from "../features/headquarters/components/TxOverlay";
import { HqHeader } from "../features/headquarters/components/Chrome";
import { syncDemoRoster, toLocalRecruits } from "../features/headquarters/mapping";
import { useHeadquarters } from "../features/headquarters/useHeadquarters";
import { AppearancePanel } from "../features/squad/components/AppearancePanel";
import { CharacterViewport } from "../features/squad/components/CharacterViewport";
import { StatsPanel } from "../features/squad/components/StatsPanel";
import { requestSignIn } from "../signIn";
import "../features/squad/squad.css";
import "../features/headquarters/headquarters.css";

type Panel = "Loadout" | "Stats" | "Appearance" | "Dossier";
const PANELS: Panel[] = ["Loadout", "Stats", "Appearance", "Dossier"];

interface Draft {
    appearance: Appearance;
    armorColors: ArmorColors;
    voice: number;
}

const encodeDraft = (d: Draft) => encodeVisuals(d.appearance, d.armorColors);
const sameDraft = (a: Draft, b: Draft) =>
    a.voice === b.voice && sameVisuals(encodeDraft(a), encodeDraft(b));

export default function Headquarters() {
    const { connected, accountId, recruitsQuery, armory, action, slots, recruits, onFile, gate } =
        useHeadquarters();
    // Recomputed per data or order change only: the studio redraws on new identities.
    const orderKey = recruits.map((r) => r.objectId).join();
    const locals = useMemo(() => toLocalRecruits(recruits), [recruitsQuery.data, orderKey]);
    useEffect(() => syncDemoRoster(locals), [locals]);

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [panel, setPanel] = useState<Panel>("Loadout");
    const [focus, setFocus] = useState<Focus>("body");
    const [drafts, setDrafts] = useState<Record<string, Draft>>({});
    const [portraits, setPortraits] = useState<Record<string, string>>({});
    const [images, setImages] = useState<Record<string, string>>({});
    // The deck stays up after a hire from zero until the player walks in.
    const [deck, setDeck] = useState(false);
    // Hired recruits still arriving: listing them lags the hire by a moment.
    const [incoming, setIncoming] = useState(false);
    if (incoming && recruits.length >= FREE_RECRUITS) setIncoming(false);
    useEffect(() => {
        if (!incoming) return;
        const timer = window.setTimeout(() => setIncoming(false), 20_000);
        return () => window.clearTimeout(timer);
    }, [incoming]);

    const recruit = recruits.find((r) => r.objectId === selectedId) ?? recruits[0] ?? null;
    const local = recruit ? locals.find((l) => l.id === recruit.objectId) : undefined;
    const saved = useMemo<Draft | null>(
        () =>
            local && recruit
                ? {
                      appearance: local.appearance,
                      armorColors: local.armorColors,
                      voice: recruit.metadata.voice,
                  }
                : null,
        [local, recruit],
    );
    const draft = (recruit && drafts[recruit.objectId]) || saved;
    const dirty = !!draft && !!saved && !sameDraft(draft, saved);
    const dirtyIds = new Set(
        Object.entries(drafts)
            .filter(([id, d]) => {
                const l = locals.find((x) => x.id === id);
                const r = recruits.find((x) => x.objectId === id);
                return (
                    l &&
                    r &&
                    !sameDraft(d, {
                        appearance: l.appearance,
                        armorColors: l.armorColors,
                        voice: r.metadata.voice,
                    })
                );
            })
            .map(([id]) => id),
    );
    // What the studio renders for the selected recruit: saved gear, draft looks.
    const preview = useMemo(
        () => (local && draft ? { ...local, armorColors: draft.armorColors } : null),
        [local, draft],
    );

    const busy = action.busy ?? (incoming ? "Receiving recruits" : null);
    const pending = !!action.busy || incoming;

    function patch(changes: Partial<Draft>) {
        if (!recruit || !draft) return;
        setDrafts((d) => ({ ...d, [recruit.objectId]: { ...draft, ...changes } }));
    }
    function discard() {
        if (!recruit) return;
        setDrafts((d) => {
            const next = { ...d };
            delete next[recruit.objectId];
            return next;
        });
    }

    async function hire(fromDeck: boolean) {
        const owner = connected?.address;
        if (!owner) return requestSignIn();
        const steps: Step[] = [];
        const opening = !accountId.data;
        if (opening) steps.push({ label: "Opening your account (1/2)", build: createAccountTx });
        steps.push({
            label: opening ? "Hiring recruits (2/2)" : "Hiring recruits",
            build: async () => {
                const id = accountId.data ?? (await fetchAccountId(action.client, owner));
                if (!id) throw new Error("No account on file for this address.");
                return hireRecruitsTx(id);
            },
        });
        if (fromDeck) setDeck(true);
        if (await action.run(steps)) setIncoming(true);
    }

    function act(label: string, build: () => Transaction) {
        void action.run([{ label, build }]);
    }

    async function save() {
        if (!recruit || !draft || !accountId.data) return;
        const id = recruit.objectId;
        const ok = await action.run([
            {
                label: `Saving ${recruit.metadata.name}`,
                build: () => editRecruitTx(accountId.data!, id, encodeDraft(draft), draft.voice),
            },
        ]);
        if (ok)
            setDrafts((d) => {
                const next = { ...d };
                delete next[id];
                return next;
            });
    }

    const showDeck = !gate && (onFile === 0 || deck);

    return (
        <main className="squad-screen hq-screen">
            <HqHeader
                status={
                    recruits.length > 0 &&
                    `${String(recruits.length).padStart(2, "0")} operatives on file`
                }
            />
            {gate ?? (
                <div
                    className={`squad-workspace ${showDeck ? "hq-deck-mode" : ""}`}
                    inert={pending}
                >
                    {!showDeck && (
                        <aside className="squad-roster" aria-label="Squad roster">
                            <div className="roster-heading">
                                <h2>OPERATIVES</h2>
                                <span>
                                    {String(recruits.length).padStart(2, "0")} /{" "}
                                    {String(FREE_RECRUITS).padStart(2, "0")}
                                </span>
                            </div>
                            <div className="roster-list">
                                {slots.map((r, i) => (
                                    <RecruitCard
                                        key={i}
                                        index={i}
                                        variant="roster"
                                        recruit={r}
                                        portrait={r ? portraits[r.objectId] : undefined}
                                        selected={!!r && r.objectId === recruit?.objectId}
                                        dirty={!!r && dirtyIds.has(r.objectId)}
                                        pending={pending}
                                        onClick={() =>
                                            r ? setSelectedId(r.objectId) : void hire(false)
                                        }
                                    />
                                ))}
                            </div>
                        </aside>
                    )}
                    <div className="hq-stage">
                        {recruit && preview && draft && (
                            <div className={`hq-stage-view ${showDeck ? "is-hidden" : ""}`}>
                                <CharacterViewport
                                    recruit={preview}
                                    appearance={draft.appearance}
                                    recruits={locals}
                                    focus={focus}
                                    onFocus={setFocus}
                                    onPortrait={(id, url) =>
                                        setPortraits((p) => ({ ...p, [id]: url }))
                                    }
                                    onEquipment={setImages}
                                    eyebrow={`${recruit.rank.$kind} / ON-CHAIN ROSTER`}
                                />
                            </div>
                        )}
                        {showDeck && (
                            <HireDeck
                                slots={slots}
                                portraits={portraits}
                                pending={pending}
                                error={action.error}
                                onHire={() => void hire(true)}
                                onEnter={(id) => {
                                    setSelectedId(id);
                                    setDeck(false);
                                }}
                            />
                        )}
                    </div>
                    {!showDeck && recruit && local && draft && (
                        <section className="squad-inspector" aria-label="Operative management">
                            <nav className="inspector-tabs" aria-label="Operative sections">
                                {PANELS.map((p) => (
                                    <button
                                        key={p}
                                        aria-pressed={panel === p}
                                        onClick={() => {
                                            setPanel(p);
                                            setFocus("body");
                                        }}
                                    >
                                        {p}
                                        {dirty && p !== "Stats" && (
                                            <i aria-label="Unsaved changes" />
                                        )}
                                    </button>
                                ))}
                            </nav>
                            {action.error && (
                                <p role="alert" className="sq-error">
                                    {action.error}
                                </p>
                            )}
                            <div
                                className={`inspector-content ${panel === "Appearance" ? "inspector-appearance" : ""}`}
                            >
                                {panel === "Loadout" ? (
                                    <LoadoutPanel
                                        accountId={accountId.data!}
                                        recruit={recruit}
                                        local={local}
                                        colors={draft.armorColors}
                                        onColors={(armorColors) => patch({ armorColors })}
                                        weapons={armory.weapons}
                                        armors={armory.armors}
                                        images={images}
                                        busy={pending}
                                        act={act}
                                    />
                                ) : panel === "Stats" ? (
                                    <StatsPanel recruit={local} tag={recruit.rank.$kind} />
                                ) : panel === "Appearance" ? (
                                    <AppearancePanel
                                        value={draft.appearance}
                                        onChange={(appearance) => patch({ appearance })}
                                        dirty={dirty}
                                        onSave={() => void save()}
                                        onReset={discard}
                                        onFocus={setFocus}
                                    />
                                ) : (
                                    <DossierPanel
                                        recruit={recruit}
                                        voice={draft.voice}
                                        onVoice={(voice) => patch({ voice })}
                                    />
                                )}
                            </div>
                            {dirty && panel !== "Appearance" && (
                                <div className="hq-unsaved">
                                    <span>Unsaved changes</span>
                                    <button onClick={discard}>Discard</button>
                                    <button className="btn sq-primary" onClick={() => void save()}>
                                        Save to chain <span>↗</span>
                                    </button>
                                </div>
                            )}
                        </section>
                    )}
                </div>
            )}
            <TxOverlay label={busy} />
            <PadHints className="squad-pad-hints" entries={[["b", "Back"]]} />
        </main>
    );
}

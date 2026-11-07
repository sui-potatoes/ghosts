// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Headquarters at `/headquarters`: the player's squad on Sui. Recruitment
 * deals four face-down cards that turn over one by one as the free hires
 * land; from
 * there each operative gets the full squad studio — loadout from the
 * account's armory, stats, the character editor and their dossier (voice
 * auditions, dismissal). Looks and
 * voice edit as a per-recruit draft and save in one transaction; gear moves
 * immediately. Leaving with unsaved drafts asks to save or discard; saving
 * on the way out runs in the background behind the next screen. See
 * `src/features/headquarters/README.md`.
 */

import type { Transaction } from "@mysten/sui/transactions";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { encodeVisuals, sameVisuals } from "@ghosts/squad/appearance/codec";
import type { Focus } from "@ghosts/squad/studio/recruit-studio";
import type { Appearance, ArmorColors } from "@ghosts/squad/types";

import {
    createAccountTx,
    dismissRecruitTx,
    editRecruitsTx,
    fetchAccountId,
    FREE_RECRUITS,
    HIRE_PRICE,
    hireRecruitsTx,
    hireRecruitTx,
    MAX_RECRUITS,
    type RecruitEdit,
    type Step,
} from "../chain";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { PadHints } from "../components/PadHints";
import { DossierPanel } from "../features/headquarters/components/DossierPanel";
import { HireDeck } from "../features/headquarters/components/HireDeck";
import { LoadoutPanel } from "../features/headquarters/components/LoadoutPanel";
import { RecruitCard } from "../features/headquarters/components/RecruitCard";
import { HqHeader } from "../features/headquarters/components/Chrome";
import { useEquipmentImages } from "../features/headquarters/equipmentImages";
import { syncDemoRoster, toLocalRecruits } from "../features/headquarters/mapping";
import { useHeadquarters } from "../features/headquarters/useHeadquarters";
import { AppearancePanel } from "../features/squad/components/AppearancePanel";
import { CharacterViewport } from "../features/squad/components/CharacterViewport";
import { StatsPanel } from "../features/squad/components/StatsPanel";
import { useBack } from "../hooks/useBack";
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

/**
 * Portraits outlive the screen: a return visit shows the last drawn faces at
 * once while the studio redraws any whose looks changed.
 */
const portraitCache: Record<string, string> = {};

/**
 * Unsaved looks survive a reload or a closed tab: drafts are kept on the
 * device by recruit id and come back marked unsaved. A draft for a recruit no
 * longer on file, or one the chain already matches, simply never shows.
 */
const DRAFTS_KEY = "ghosts:hq-drafts";
function storedDrafts(): Record<string, Draft> {
    try {
        return JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? "{}") as Record<string, Draft>;
    } catch {
        return {};
    }
}
function storeDrafts(drafts: Record<string, Draft>) {
    try {
        if (Object.keys(drafts).length) localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
        else localStorage.removeItem(DRAFTS_KEY);
    } catch {
        // storage unavailable: drafts last as long as the screen
    }
}

const encodeDraft = (d: Draft) => encodeVisuals(d.appearance, d.armorColors);
const sameDraft = (a: Draft, b: Draft) =>
    a.voice === b.voice && sameVisuals(encodeDraft(a), encodeDraft(b));

export default function Headquarters() {
    const {
        connected,
        accountId,
        account,
        recruitsQuery,
        armory,
        action,
        slots,
        recruits,
        onFile,
        gate,
    } = useHeadquarters();
    // Recomputed per data or order change only: the studio redraws on new identities.
    const orderKey = recruits.map((r) => r.objectId).join();
    const locals = useMemo(() => toLocalRecruits(recruits), [recruitsQuery.data, orderKey]);
    useEffect(() => syncDemoRoster(locals), [locals]);

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [panel, setPanel] = useState<Panel>("Loadout");
    const [focus, setFocus] = useState<Focus>("body");
    const [drafts, setDrafts] = useState<Record<string, Draft>>(storedDrafts);
    useEffect(() => storeDrafts(drafts), [drafts]);
    // Once the squad is read, stored drafts that the chain already matches (or
    // whose recruit left) are dropped, so a look changed elsewhere is not undone.
    useEffect(() => {
        if (!recruitsQuery.data) return;
        setDrafts((current) => {
            const kept = Object.entries(current).filter(([id, d]) => {
                const l = locals.find((x) => x.id === id);
                const r = recruits.find((x) => x.objectId === id);
                if (!l || !r) return false;
                return !sameDraft(d, {
                    appearance: l.appearance,
                    armorColors: l.armorColors,
                    voice: r.metadata.voice,
                });
            });
            return kept.length === Object.keys(current).length ? current : Object.fromEntries(kept);
        });
    }, [locals]);
    const [portraits, setPortraits] = useState<Record<string, string>>(() => ({
        ...portraitCache,
    }));
    // Gear thumbnails shared with the Armory (and kept between visits).
    const images = useEquipmentImages();
    // The deck stays up after a hire from zero until the player walks in.
    const [deck, setDeck] = useState(false);
    // A hire from the press until its recruits are listed (listing lags the
    // transaction by a moment), so the cards stay face down in between. The
    // safety timeout only runs once the transactions are done.
    const [incoming, setIncoming] = useState(false);
    if (incoming && recruits.length >= FREE_RECRUITS) setIncoming(false);
    useEffect(() => {
        if (!incoming || action.busy) return;
        const timer = window.setTimeout(() => setIncoming(false), 20_000);
        return () => window.clearTimeout(timer);
    }, [incoming, action.busy]);

    const recruit = recruits.find((r) => r.objectId === selectedId) ?? recruits[0] ?? null;
    const local = recruit ? locals.find((l) => l.id === recruit.objectId) : undefined;
    // Looks being saved count as saved from the press: nothing reads as
    // unsaved (or prompts on leaving) while the transaction is in flight. A
    // failed save drops the entry and the draft is unsaved again.
    const [committed, setCommitted] = useState<Record<string, Draft>>({});
    /** What a recruit's draft is measured against: the save in flight, else the chain. */
    const baseline = (id: string): Draft | null => {
        if (committed[id]) return committed[id];
        const l = locals.find((x) => x.id === id);
        const r = recruits.find((x) => x.objectId === id);
        return l && r
            ? { appearance: l.appearance, armorColors: l.armorColors, voice: r.metadata.voice }
            : null;
    };
    const saved = useMemo<Draft | null>(
        () =>
            local && recruit
                ? (committed[recruit.objectId] ?? {
                      appearance: local.appearance,
                      armorColors: local.armorColors,
                      voice: recruit.metadata.voice,
                  })
                : null,
        [local, recruit, committed],
    );
    const draft = (recruit && drafts[recruit.objectId]) || saved;
    const dirty = !!draft && !!saved && !sameDraft(draft, saved);
    const dirtyIds = new Set(
        Object.entries(drafts)
            .filter(([id, d]) => {
                const base = baseline(id);
                return base && !sameDraft(d, base);
            })
            .map(([id]) => id),
    );
    // What the studio renders for the selected recruit: saved gear, draft looks.
    const preview = useMemo(
        () => (local && draft ? { ...local, armorColors: draft.armorColors } : null),
        [local, draft],
    );

    const pending = action.busy || incoming;

    // Leaving with unsaved drafts. Escape and the header links ask first;
    // "Save" sends every changed recruit in one transaction and leaves at
    // once, the corner spinner covering the save. Any other way out (the
    // browser's back) saves the same way unless the player chose Discard.
    const navigate = useNavigate();
    const [leaving, setLeaving] = useState<(() => void) | null>(null);
    const edits: RecruitEdit[] = [...dirtyIds].map((id) => ({
        recruitId: id,
        areas: encodeDraft(drafts[id]),
        voice: drafts[id].voice,
    }));
    const settled = useRef(false);
    const flush = useRef(() => {});
    flush.current = () => {
        const id = accountId.data;
        if (settled.current || !edits.length || !id) return;
        settled.current = true;
        void action.run([() => editRecruitsTx(id, edits)]);
    };
    useEffect(() => () => flush.current(), []);
    // A reload or a closed tab needs no warning: the drafts are stored and come back.
    const unsaved = edits.length > 0;
    function guard(go: () => void) {
        if (unsaved) setLeaving(() => go);
        else go();
    }
    // Mirrors EscapeBack, which this entry outranks while drafts are open.
    useBack(
        unsaved
            ? () =>
                  guard(() => {
                      const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
                      if (idx > 0) navigate(-1);
                      else navigate("/", { replace: true });
                  })
            : null,
    );
    function leave(save: boolean) {
        const go = leaving;
        setLeaving(null);
        if (save) flush.current();
        else storeDrafts({});
        settled.current = true;
        go?.();
    }
    const unsavedNames = edits
        .map((e) => recruits.find((r) => r.objectId === e.recruitId)?.metadata.name)
        .filter(Boolean)
        .join(", ");

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
        if (!accountId.data) steps.push(createAccountTx);
        steps.push(async () => {
            const id = accountId.data ?? (await fetchAccountId(action.client, owner));
            if (!id) throw new Error("No account on file for this address.");
            return hireRecruitsTx(id);
        });
        if (fromDeck) setDeck(true);
        setIncoming(true);
        if (!(await action.run(steps))) setIncoming(false);
    }

    function act(build: () => Transaction) {
        void action.run([build]);
    }

    async function dismiss() {
        if (!recruit || !accountId.data) return;
        const id = recruit.objectId;
        if (await action.run([() => dismissRecruitTx(accountId.data!, id)])) {
            setSelectedId(null);
            setDrafts((d) => {
                const next = { ...d };
                delete next[id];
                return next;
            });
        }
    }

    async function save() {
        if (!recruit || !draft || !accountId.data) return;
        const id = recruit.objectId;
        const sent = draft;
        setCommitted((c) => ({ ...c, [id]: sent }));
        const ok = await action.run([
            () =>
                editRecruitsTx(accountId.data!, [
                    { recruitId: id, areas: encodeDraft(sent), voice: sent.voice },
                ]),
        ]);
        setCommitted((c) => {
            const next = { ...c };
            delete next[id];
            return next;
        });
        // Saved and refreshed: the chain now holds this look. Edits made while
        // it was in flight stay as the next draft.
        if (ok)
            setDrafts((d) => {
                if (!d[id] || !sameDraft(d[id], sent)) return d;
                const next = { ...d };
                delete next[id];
                return next;
            });
    }

    const showDeck = !gate && (onFile === 0 || deck);

    return (
        <main className="squad-screen hq-screen">
            <HqHeader
                guard={guard}
                status={
                    recruits.length > 0 && account.data
                        ? `${account.data.credits} credits · Rating ${account.data.rating.rating} · ${account.data.score.wins}W ${account.data.score.losses}L ${account.data.score.draws}D`
                        : ""
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
                                    {String(MAX_RECRUITS).padStart(2, "0")}
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
                            {recruits.length >= FREE_RECRUITS &&
                                recruits.length < MAX_RECRUITS &&
                                accountId.data && (
                                    <button
                                        className="btn roster-hire"
                                        disabled={
                                            pending ||
                                            Number(account.data?.credits ?? 0) < HIRE_PRICE
                                        }
                                        onClick={() =>
                                            void action.run([() => hireRecruitTx(accountId.data!)])
                                        }
                                    >
                                        Hire · {HIRE_PRICE} credits
                                    </button>
                                )}
                            {action.error && <p className="sq-footnote hq-error">{action.error}</p>}
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
                                    onPortrait={(id, url) => {
                                        portraitCache[id] = url;
                                        setPortraits((p) => ({ ...p, [id]: url }));
                                    }}
                                    eyebrow={`${recruit.rank.$kind} / ACTIVE ROSTER`}
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
                                        busy={pending}
                                        onVoice={(voice) => patch({ voice })}
                                        onDismiss={() => void dismiss()}
                                    />
                                )}
                            </div>
                            {dirty && panel !== "Appearance" && (
                                <div className="hq-unsaved">
                                    <span>Unsaved changes</span>
                                    <button onClick={discard}>Discard</button>
                                    <button className="btn sq-primary" onClick={() => void save()}>
                                        Save <span>↗</span>
                                    </button>
                                </div>
                            )}
                        </section>
                    )}
                </div>
            )}
            <ConfirmDialog
                open={!!leaving}
                title="Unsaved changes"
                cancelLabel="Save"
                confirmLabel="Discard"
                danger
                onCancel={() => leave(true)}
                onConfirm={() => leave(false)}
                onClose={() => setLeaving(null)}
            >
                {unsavedNames} {edits.length > 1 ? "have" : "has"} unsaved changes. Save them before
                you go?
            </ConfirmDialog>
            <PadHints className="squad-pad-hints" entries={[["b", "Back"]]} />
        </main>
    );
}

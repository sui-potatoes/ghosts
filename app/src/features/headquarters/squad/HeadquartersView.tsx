// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * HQ / Squad in the shared interface language (src/ui): the roster, the
 * selected recruit on the character stage, and an inspector whose four
 * sections (Loadout, Stats, Appearance, Dossier) are the header's tabs. With
 * no squad on file the body is the recruitment deck; before the account can
 * be read it is a gate. The view takes everything as props — the screen
 * (`src/screens/Headquarters.tsx`) feeds it from the account and turns its
 * `ops` into transactions — so it can be driven by fixtures too.
 *
 * Gear moves at once (one transaction per command). Looks and voice are a
 * draft per recruit that saves as one `edit_recruit` per recruit; leaving
 * with drafts asks first, and any other way out saves them.
 */

import type { Appearance, Recruit as LocalRecruit } from "@ghosts/squad/types";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { stopPreview, uiTick } from "../../../audio";
import { FREE_RECRUITS, type ChainRecruit, type RecruitEdit } from "../../../chain";
import {
    FocusRoot,
    List,
    ListRow,
    Panel,
    Prompt,
    StagePanel,
    StatusChip,
    Tabs,
    Thumb,
    useFocusState,
    useGlyphSet,
    type Command,
    type TabDef,
} from "../../../ui";
import { useRecruitPortraits } from "../../squad/useRecruitPortraits";
import { useEquipmentImages } from "../equipmentImages";
import {
    HqFrame,
    HqGateView,
    MatchChip,
    SearchPrompt,
    useLeave,
    type FrameBits as SharedFrameBits,
} from "../frame";
import {
    armorModel,
    syncDemoRoster,
    toLocalRecruits,
    upgradeModel,
    utilityModel,
    weaponModel,
} from "../mapping";
import { useWeaponSkins } from "../skins";
import { AppearanceEditor, HEAD_SECTIONS } from "./AppearanceEditor";
import { CharacterCanvas, useWireframeAction } from "./CharacterCanvas";
import { Dossier, DismissPrompt } from "./Dossier";
import {
    encodeDraft,
    pruneDrafts,
    settleSaved,
    storeDrafts,
    storedDrafts,
    unsavedIds,
    withoutDraft,
    type Draft,
    type Drafts,
} from "./drafts";
import { utilityStats, weaponName } from "./gear";
import { GearPicker, LoadoutRows } from "./Loadout";
import { Offstage, Portrait, RankMark, SquadStats } from "./parts";
import { Deck } from "./Recruitment";
import { hireOffer, holdingRifle, type GearSlot } from "./rules";
import type { HqData, HqOps } from "./types";
import "./squad.css";

type Tab = "loadout" | "stats" | "appearance" | "dossier";

const TABS: TabDef[] = [
    { id: "loadout", label: "Loadout" },
    { id: "stats", label: "Stats" },
    { id: "appearance", label: "Appearance" },
    { id: "dossier", label: "Dossier" },
];

const ARMORY = "/headquarters/armory";
type Prompted =
    | { kind: "leave"; go: () => void }
    | { kind: "dismiss"; recruit: ChainRecruit }
    | { kind: "search" }
    | null;

// === Screen ===============================================================

export type { HqData, HqGate, HqOps } from "./types";

export function HeadquartersView({ data, ops }: { data: HqData; ops: HqOps }) {
    const navigate = useNavigate();
    const glyphs = useGlyphSet();
    const [tab, setTab] = useState<Tab>("loadout");
    const recruits = useMemo(() => data.slots.filter((s): s is ChainRecruit => !!s), [data.slots]);
    // Recomputed per data or order change only: the stage rebuilds on new identities.
    // Finishes follow the device's choices (an Armory change shows on return).
    const skins = useWeaponSkins();
    const mapped = useMemo(() => toLocalRecruits(recruits, skins), [recruits, skins]);
    // The local playtest keeps its own default rifle (`mapping.ts`).
    useEffect(() => syncDemoRoster(mapped), [mapped]);
    // On this screen a recruit without a weapon object is unarmed, as in the field
    // (`unit::from_recruit` gives Attack and Reload only with a weapon).
    const locals = useMemo(
        () =>
            mapped.map((l, i) =>
                recruits[i].weapon
                    ? l
                    : { ...l, equipment: { ...l.equipment, primary: null }, attachments: {} },
            ),
        [mapped, recruits],
    );
    const { portraits, studioHost } = useRecruitPortraits(locals);

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const recruit = recruits.find((r) => r.objectId === selectedId) ?? recruits[0] ?? null;
    const local = recruit ? locals.find((l) => l.id === recruit.objectId) : undefined;

    // --- Drafts -------------------------------------------------------------
    const [drafts, setDrafts] = useState<Drafts>(storedDrafts);
    useEffect(() => storeDrafts(drafts), [drafts]);
    const chainLook = (id: string): Draft | null => {
        const l = locals.find((x) => x.id === id);
        const r = recruits.find((x) => x.objectId === id);
        return l && r
            ? { appearance: l.appearance, armorColors: l.armorColors, voice: r.metadata.voice }
            : null;
    };
    // Once the squad is read, drafts the chain already matches (or whose recruit left) go.
    const read = data.gate === null;
    useEffect(() => {
        if (read) setDrafts((current) => pruneDrafts(current, chainLook));
    }, [locals, read]);
    // A look being saved counts as saved from the press; a failed save drops it again.
    const [committed, setCommitted] = useState<Drafts>({});
    const baseline = (id: string) => committed[id] ?? chainLook(id);
    const unsaved = unsavedIds(drafts, baseline);
    const saved = recruit ? baseline(recruit.objectId) : null;
    const draft = (recruit && drafts[recruit.objectId]) || saved;
    const dirty = !!recruit && unsaved.includes(recruit.objectId);
    const edits: RecruitEdit[] = unsaved.map((id) => ({
        recruitId: id,
        areas: encodeDraft(drafts[id]),
        voice: drafts[id].voice,
    }));

    const patch = (changes: Partial<Draft>) => {
        if (!recruit || !draft) return;
        setDrafts((d) => ({ ...d, [recruit.objectId]: { ...draft, ...changes } }));
    };
    const discard = () => recruit && setDrafts((d) => withoutDraft(d, recruit.objectId));

    async function save() {
        if (!recruit || !draft || !dirty) return;
        const id = recruit.objectId;
        const sent = draft;
        setCommitted((c) => ({ ...c, [id]: sent }));
        const ok = await ops.saveLooks([
            { recruitId: id, areas: encodeDraft(sent), voice: sent.voice },
        ]);
        setCommitted((c) => withoutDraft(c, id));
        if (ok) setDrafts((d) => settleSaved(d, id, sent));
    }

    // Any way out but Discard saves the drafts: the unmount sends them, once.
    const settled = useRef(false);
    const flush = useRef(() => {});
    flush.current = () => {
        if (settled.current || !edits.length || !data.accountId) return;
        settled.current = true;
        void ops.saveLooks(edits);
    };
    useEffect(() => () => flush.current(), []);

    // --- Prompts, leaving -----------------------------------------------------
    const [prompt, setPrompt] = useState<Prompted>(null);
    const guard = (go: () => void) => {
        if (edits.length) setPrompt({ kind: "leave", go });
        else go();
    };
    const leave = useLeave();
    const toArmory = (itemId?: string) =>
        guard(() => navigate(itemId ? `${ARMORY}?item=${itemId}` : ARMORY));

    // --- Recruitment ----------------------------------------------------------
    // The deck stays up after a hire from zero until the player walks in.
    const [deck, setDeck] = useState(false);
    // A hire from the press until its recruits are listed (listing lags the
    // transaction by a moment), so the cards stay face down in between.
    const [incoming, setIncoming] = useState(false);
    if (incoming && recruits.length >= FREE_RECRUITS) setIncoming(false);
    useEffect(() => {
        if (!incoming || data.busy) return;
        const timer = window.setTimeout(() => setIncoming(false), 20_000);
        return () => window.clearTimeout(timer);
    }, [incoming, data.busy]);
    const pending = data.busy || incoming;

    async function hireSquad(fromDeck: boolean) {
        if (fromDeck) setDeck(true);
        setIncoming(true);
        if (!(await ops.hireSquad())) setIncoming(false);
    }

    const showDeck = data.gate === null && (data.onFile === 0 || deck);
    const mode = data.gate !== null ? "gate" : showDeck ? "deck" : "squad";

    // --- Header -----------------------------------------------------------------
    const status = (
        <>
            <MatchChip match={data.match} onSearch={() => setPrompt({ kind: "search" })} />
            {data.saving ? (
                <StatusChip label="Records" value="Saving" state="busy" />
            ) : (
                unsaved.length > 0 && (
                    <StatusChip
                        label="Looks"
                        value={unsaved.length > 1 ? `${unsaved.length} unsaved` : "Unsaved"}
                        tone="warn"
                    />
                )
            )}
            {mode === "squad" && data.rating !== undefined && (
                <StatusChip label="Rating" value={data.rating} state="idle" />
            )}
        </>
    );

    const names = (ids: string[]) =>
        ids
            .map((id) => recruits.find((r) => r.objectId === id)?.metadata.name)
            .filter(Boolean)
            .join(", ");

    const overlay =
        prompt?.kind === "leave" ? (
            <Prompt
                id="prompt-unsaved"
                eyebrow="Unsaved changes"
                title={
                    unsaved.length > 1
                        ? `Save ${unsaved.length} new looks?`
                        : `Save ${names(unsaved)}'s new look?`
                }
                hint="Discard restores the last saved look and voice"
                confirm={{
                    label: "Save",
                    run: () => {
                        const go = prompt.go;
                        setPrompt(null);
                        flush.current();
                        go();
                    },
                }}
                alternate={{
                    label: "Discard",
                    run: () => {
                        const go = prompt.go;
                        settled.current = true;
                        storeDrafts({});
                        setDrafts({});
                        setPrompt(null);
                        go();
                    },
                }}
                cancel={{ label: "Keep editing", run: () => setPrompt(null) }}
                glyphs={glyphs}
            >
                {unsaved.length > 1 ? names(unsaved) : "The look and voice"} would be lost unless
                they are saved.
            </Prompt>
        ) : prompt?.kind === "dismiss" ? (
            <DismissPrompt
                recruit={prompt.recruit}
                glyphs={glyphs}
                onConfirm={async () => {
                    const id = prompt.recruit.objectId;
                    setPrompt(null);
                    if (await ops.dismiss(id)) {
                        setSelectedId(null);
                        setDrafts((d) => withoutDraft(d, id));
                    }
                }}
                onCancel={() => setPrompt(null)}
            />
        ) : prompt?.kind === "search" ? (
            <SearchPrompt
                glyphs={glyphs}
                onStop={() => {
                    setPrompt(null);
                    data.match.cancel();
                }}
                onKeep={() => setPrompt(null)}
            />
        ) : null;

    const onTab = (step: 1 | -1) => {
        if (mode !== "squad") return;
        uiTick(null);
        const i = TABS.findIndex((t) => t.id === tab);
        setTab(TABS[(i + step + TABS.length) % TABS.length].id as Tab);
    };

    const frame = {
        status,
        overlay,
        glyphs,
        onLeave: () => guard(leave),
        onSwitch: () => toArmory(),
        error: data.error,
        clearError: data.clearError,
    };

    return (
        <FocusRoot
            back={{ action: "back", label: "Leave", run: () => guard(leave) }}
            onTab={onTab}
            onSection={() => toArmory()}
        >
            {mode === "gate" ? (
                <HqGateView section="squad" gate={data.gate!} frame={frame} onSignIn={ops.signIn} />
            ) : mode === "deck" ? (
                <Frame frame={frame} columns="minmax(0, 1fr)" focus="deck">
                    <Deck
                        slots={data.slots.slice(0, FREE_RECRUITS)}
                        portraits={portraits}
                        pending={pending}
                        onHire={() => void hireSquad(true)}
                        onEnter={(id) => {
                            setSelectedId(id);
                            setDeck(false);
                        }}
                    />
                    <Offstage ref={studioHost} />
                </Frame>
            ) : recruit && local && draft ? (
                <Squad
                    frame={frame}
                    tab={tab}
                    onTab={(t) => {
                        uiTick(null);
                        setTab(t);
                    }}
                    data={data}
                    ops={ops}
                    recruits={recruits}
                    recruit={recruit}
                    local={local}
                    draft={draft}
                    dirty={dirty}
                    unsaved={unsaved}
                    portraits={portraits}
                    pending={pending}
                    select={setSelectedId}
                    patch={patch}
                    save={() => void save()}
                    discard={discard}
                    hireSquad={() => void hireSquad(false)}
                    toArmory={toArmory}
                    onDismiss={(r) => setPrompt({ kind: "dismiss", recruit: r })}
                    studioHost={<Offstage ref={studioHost} />}
                />
            ) : (
                <Frame frame={frame} columns="minmax(0, 1fr)">
                    <div className="gui-void">
                        <span className="gui-void-mark" aria-hidden />
                    </div>
                    <Offstage ref={studioHost} />
                </Frame>
            )}
        </FocusRoot>
    );
}

// === Frame ===================================================================

type FrameBits = SharedFrameBits;

function Frame(props: Omit<Parameters<typeof HqFrame>[0], "section">) {
    return <HqFrame section="squad" {...props} />;
}

// === The workspace ==========================================================

type SquadProps = {
    frame: FrameBits;
    tab: Tab;
    onTab: (tab: Tab) => void;
    data: HqData;
    ops: HqOps;
    recruits: ChainRecruit[];
    recruit: ChainRecruit;
    local: LocalRecruit;
    draft: Draft;
    dirty: boolean;
    unsaved: string[];
    portraits: Record<string, string>;
    pending: boolean;
    select: (id: string) => void;
    patch: (changes: Partial<Draft>) => void;
    save: () => void;
    discard: () => void;
    hireSquad: () => void;
    toArmory: (itemId?: string) => void;
    onDismiss: (recruit: ChainRecruit) => void;
    studioHost: ReactNode;
};

function Squad(props: SquadProps) {
    const { frame, tab, data, ops, recruits, recruit, local, draft, pending } = props;
    const store = useFocusState();
    const wire = useWireframeAction();
    const images = useEquipmentImages();
    const skins = useWeaponSkins();
    const [stage, setStage] = useState<{ loading: boolean; error?: string }>({ loading: true });
    const [picker, setPicker] = useState<GearSlot | null>(null);
    /** A grid tile under the cursor, worn on top of the draft. */
    const [lookPreview, setLookPreview] = useState<Partial<Appearance> | null>(null);
    const [face, setFace] = useState(false);
    const rid = recruit.objectId;

    // Entering puts the cursor on the roster; a new tab on the inspector's first row.
    useLayoutEffect(() => {
        store.focusGroup("list", true);
    }, [store]);
    const firstTab = useRef(true);
    useLayoutEffect(() => {
        if (firstTab.current) {
            firstTab.current = false;
            return;
        }
        setPicker(null);
        setLookPreview(null);
        setFace(false);
        store.focusGroup("inspector");
    }, [store, tab]);
    // A new recruit on stage closes the picker; an audition belongs to its recruit.
    useEffect(() => {
        setPicker(null);
        return () => stopPreview();
    }, [rid]);

    /** A write: refused while another is in flight. */
    const write = (label: string, run: () => unknown, extra?: Partial<Command>): Command => ({
        action: "confirm",
        label,
        tone: "primary",
        deny: pending ? "Still saving" : undefined,
        run: () => void run(),
        ...extra,
    });
    const toRoster: Command = {
        action: "back",
        label: "Roster",
        run: () => store.focusGroup("list", true, true),
    };

    // The picker previews the focused item on the operative.
    const focusedId = picker ? store.node(store.focused)?.id : undefined;
    const candidate = picker && focusedId?.startsWith("pick-") ? focusedId.slice(5) : undefined;
    const onStage = useMemo<LocalRecruit>(() => {
        const r: LocalRecruit = { ...local, armorColors: draft.armorColors };
        if (!picker || !candidate) return r;
        // The picker's None row: the slot as it would be emptied.
        if (candidate === "none")
            return picker === "utility"
                ? { ...r, equipment: { ...r.equipment, utility: null } }
                : picker === "armor"
                  ? { ...r, equipment: { ...r.equipment, armor: null } }
                  : holdingRifle(r, null, skins);
        const s = data.storage;
        if (picker === "primary") {
            const w = s.weapons.find((x) => x.objectId === candidate);
            if (w)
                return holdingRifle(
                    r,
                    {
                        id: w.id,
                        model: weaponModel(w),
                        attachments: Object.fromEntries(
                            w.upgrades
                                .map((u) => upgradeModel(u))
                                .filter((m) => !!m)
                                .map((m) => [m.slot, m.id]),
                        ),
                    },
                    skins,
                );
        } else if (picker === "armor") {
            const a = s.armors.find((x) => x.objectId === candidate);
            if (a) return { ...r, equipment: { ...r.equipment, armor: armorModel(a) } };
        } else {
            const u = s.utilities.find((x) => x.objectId === candidate);
            if (u) return { ...r, equipment: { ...r.equipment, utility: utilityModel(u) ?? null } };
        }
        return r;
    }, [local, draft.armorColors, picker, candidate, data.storage, skins]);

    const offer = hireOffer(recruits.length, FREE_RECRUITS);

    const roster = (
        <Panel className="hqs-roster">
            <List label="Roster">
                {recruits.map((r) => {
                    const current = r.objectId === rid;
                    return (
                        <ListRow
                            key={r.objectId}
                            id={`roster-${r.objectId}`}
                            instant
                            group="list"
                            thumb={
                                <Portrait src={props.portraits[r.objectId]} rank={r.rank.$kind} />
                            }
                            name={r.metadata.name}
                            kind={r.rank.$kind}
                            tag={props.unsaved.includes(r.objectId) ? "Edited" : undefined}
                            tagTone="warn"
                            selected={current}
                            title={r.metadata.name}
                            hint={`${r.weapon ? weaponName(r.weapon) : "Unarmed"} · ${r.armor?.name ?? "No armor"}`}
                            commands={[
                                current
                                    ? {
                                          action: "confirm",
                                          label: "Inspect",
                                          tone: "primary",
                                          run: () => store.focusGroup("inspector", true, true),
                                      }
                                    : {
                                          action: "confirm",
                                          label: "Select",
                                          tone: "primary",
                                          run: () => props.select(r.objectId),
                                      },
                            ]}
                        />
                    );
                })}
                {offer.kind === "free" && (
                    <ListRow
                        id="roster-hire"
                        group="list"
                        thumb={<Thumb />}
                        name="Hire recruits"
                        kind={`${recruits.length} / ${FREE_RECRUITS}`}
                        tag={`${offer.open} free`}
                        tagTone="accent"
                        title="Hire"
                        hint={`The squad fills up to ${FREE_RECRUITS}, free`}
                        commands={[write("Hire", props.hireSquad)]}
                    />
                )}
            </List>
        </Panel>
    );

    const stagePanel = (
        <StagePanel
            actions={[wire]}
            id="stage"
            group="stage"
            label="Stage"
            close={tab === "appearance" && face}
            loading={stage.loading}
            error={stage.error}
            back={toRoster}
            caption={
                <>
                    <span className="gui-stage-eyebrow">
                        <RankMark rank={recruit.rank.$kind} />
                    </span>
                    <span className="gui-stage-title">{recruit.metadata.name}</span>
                </>
            }
        >
            <CharacterCanvas
                recruit={onStage}
                appearance={
                    lookPreview ? { ...draft.appearance, ...lookPreview } : draft.appearance
                }
                onState={setStage}
            />
        </StagePanel>
    );

    const inspector = () => {
        switch (tab) {
            case "loadout":
                return (
                    <LoadoutRows
                        recruit={recruit}
                        local={local}
                        images={images}
                        write={write}
                        ops={ops}
                        toRoster={toRoster}
                        openPicker={setPicker}
                        toArmory={props.toArmory}
                    />
                );
            case "stats":
                return (
                    <SquadStats
                        recruit={onStage}
                        weaponName={recruit.weapon ? weaponName(recruit.weapon) : "Unarmed"}
                        armed={!!recruit.weapon}
                        names={{
                            ...(recruit.weapon && {
                                [weaponModel(recruit.weapon)]: weaponName(recruit.weapon),
                            }),
                            ...(recruit.armor && {
                                [armorModel(recruit.armor)]: recruit.armor.name,
                            }),
                        }}
                        utility={utilityStats(recruit)}
                        commands={[toRoster]}
                    />
                );
            case "appearance":
                return (
                    <AppearanceEditor
                        look={{
                            appearance: draft.appearance,
                            armorColors: draft.armorColors,
                        }}
                        dirty={props.dirty}
                        edit={(change, colors) =>
                            props.patch({
                                appearance: { ...draft.appearance, ...change },
                                ...(colors && { armorColors: colors }),
                            })
                        }
                        preview={setLookPreview}
                        save={props.save}
                        discard={props.discard}
                        onSection={(section) => setFace(HEAD_SECTIONS.has(section))}
                        toRoster={toRoster}
                    />
                );
            case "dossier":
                return (
                    <Dossier
                        recruit={recruit}
                        voice={draft.voice}
                        dirty={props.dirty}
                        write={write}
                        onVoice={(voice) => props.patch({ voice })}
                        save={props.save}
                        discard={props.discard}
                        onDismiss={() => props.onDismiss(recruit)}
                        toRoster={toRoster}
                    />
                );
        }
    };

    return (
        <Frame
            frame={frame}
            tabs={
                <Tabs
                    tabs={TABS}
                    active={tab}
                    onSelect={(id) => props.onTab(id as Tab)}
                    glyphs={frame.glyphs}
                />
            }
            columns="minmax(240px, 290px) minmax(0, 1fr) minmax(330px, 370px)"
        >
            {roster}
            {stagePanel}
            <Panel className="hqs-inspector">
                {picker ? (
                    <GearPicker
                        slot={picker}
                        recruit={recruit}
                        local={local}
                        onStage={onStage}
                        candidate={candidate}
                        storage={data.storage}
                        images={images}
                        write={write}
                        ops={ops}
                        toArmory={() => props.toArmory()}
                        onClose={() => setPicker(null)}
                    />
                ) : (
                    <div className="hqs-stack" key={tab}>
                        {inspector()}
                    </div>
                )}
            </Panel>
            {props.studioHost}
        </Frame>
    );
}

// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * HQ / Armory in the shared interface language (src/ui), the second section
 * of Headquarters' frame: what the account holds per tab (Weapons, Armor,
 * Mods, Utilities) on the left — stored and carried, with the supply catalog
 * one entry away in the same list — the item on the 3D stage in the centre,
 * and its specification and bench on the right. The view takes everything as
 * props — the screen (`src/screens/Armory.tsx`) feeds it from the account and
 * turns its `ops` into transactions — so fixtures can drive it too.
 *
 * Mods are a draft per weapon until Apply sends them as one transaction;
 * leaving with drafts asks first. Issuing, returning and requisitioning go
 * at once.
 */

import { fromPreset, normalize, presets } from "@ghosts/squad/appearance/editor-state";
import { schema } from "@ghosts/squad/appearance/schema";
import { DEFAULT_ARMOR_COLORS } from "@ghosts/squad/armor-colors";
import { ATTACHMENT_SLOT_NAMES } from "@ghosts/squad/catalog";
import {
    add,
    EMPTY,
    formatStat,
    ITEM_STATS,
    RECRUIT_DEFAULT,
    unpack,
    VISIBLE,
    type StatKey,
    type Stats,
} from "@ghosts/squad/stats";
import type { AttachmentSlot, Equipment, Recruit as LocalRecruit } from "@ghosts/squad/types";
import { skinsFor, validSkin } from "@ghosts/squad/weapon-skins";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { uiTick } from "../../../audio";
import type { ChainRecruit } from "../../../chain";
import {
    ActionRow,
    EmptyState,
    Eyebrow,
    FocusRoot,
    FocusScope,
    List,
    ListRow,
    Panel,
    Prompt,
    ReadoutLine,
    SLOT_ICON,
    SlotRow,
    StagePanel,
    STAT_ICON,
    StatRow,
    StatusChip,
    Tabs,
    Thumb,
    useFocusState,
    useGlyphSet,
    GridPicker,
    type Command,
} from "../../../ui";
import { useRecruitPortraits } from "../../squad/useRecruitPortraits";
import {
    armorStats,
    fitAttachments,
    fitOf,
    fittingsOf,
    modifierSummary,
    weaponView,
} from "../armory";
import { useEquipmentImages } from "../equipmentImages";
import { HqFrame, HqGateView, MatchChip, SearchPrompt, useLeave, type FrameBits } from "../frame";
import { toLocalRecruits } from "../mapping";
import { readWeaponSkins, saveWeaponSkin } from "../skins";
import { CharacterCanvas, useWireframeAction } from "../squad/CharacterCanvas";
import { Offstage, Portrait, StatChanges } from "../squad/parts";
import { weaponName } from "../squad/rules";
import { MAX_UTILITIES, utilityModifiers } from "../utilities";
import { GearCanvas } from "./GearCanvas";
import {
    describe,
    grants,
    heldEntries,
    modEntries,
    stageModel,
    SUPPLY,
    TABS,
    utilityGrants,
    type Entry,
    type HeldEntry,
    type ModEntry,
    type SupplyEntry,
    type Tab,
} from "./model";
import {
    attachmentFor,
    draftMod,
    fitCount,
    fitPlan,
    issueTo,
    LIMIT_REASON,
    MAX_FITTINGS,
    MOD_SLOTS,
    planSummary,
    sameFit,
    type Fit,
    type Holder,
} from "./rules";
import type { ArmoryData, ArmoryOps } from "./types";
import "./armory.css";

export type { ArmoryData, ArmoryOps } from "./types";

const SQUAD = "/headquarters";
const COLUMNS = "minmax(240px, 290px) minmax(0, 1fr) minmax(330px, 370px)";

const WEAPON_KEYS: StatKey[] = ["damage", "aim", "critChance", "range", "ammo"];
const ARMOR_KEYS: StatKey[] = ["mobility", "health", "armor", "dodge"];

type Prompted = { kind: "leave"; go: () => void } | { kind: "search" } | null;

type Picker =
    | { kind: "mod"; slot: AttachmentSlot }
    | { kind: "issue" }
    | { kind: "finish" }
    | { kind: "tryon" }
    | null;

const rowId = (e: Entry | SupplyEntry) =>
    e.kind === "supply" ? `supply-${e.id}` : e.kind === "mod" ? `mod-${e.id}` : `item-${e.id}`;

const signedText = (n: number, unit?: string) =>
    `${n < 0 ? "−" : "+"}${Math.abs(n)}${unit === "%" ? "%" : ""}`;

// === Screen ===============================================================

export function ArmoryView({ data, ops }: { data: ArmoryData; ops: ArmoryOps }) {
    const navigate = useNavigate();
    const glyphs = useGlyphSet();
    const leave = useLeave();
    const [tab, setTab] = useState<Tab>("weapons");
    const [supply, setSupply] = useState(false);
    const [drafts, setDrafts] = useState<Record<string, Fit>>({});
    const [prompt, setPrompt] = useState<Prompted>(null);
    const [focusItem, setFocusItem] = useState<string | null>(data.initialItem ?? null);

    const held = useMemo(
        () => heldEntries(data.storage, data.recruits),
        [data.storage, data.recruits],
    );
    const mods = useMemo(
        () => modEntries(data.storage.upgrades ?? [], held.weapons),
        [data.storage.upgrades, held.weapons],
    );

    // A deep link (`?item=`) opens the tab its item is on, once it is read.
    if (focusItem && !supply) {
        const on: Tab | undefined = held.weapons.some((e) => e.id === focusItem)
            ? "weapons"
            : held.armors.some((e) => e.id === focusItem)
              ? "armor"
              : held.utilities.some((e) => e.id === focusItem)
                ? "utilities"
                : undefined;
        if (on && on !== tab) setTab(on);
    }

    // Drafts that differ from what the weapon has; a weapon gone takes its draft along.
    const drafted = held.weapons.filter(
        (w) => drafts[w.id] && !sameFit(fitOf(w.gear?.upgrades), drafts[w.id]),
    );
    const applyAll = () =>
        ops.applyAll(
            drafted.map((w) => ({
                weapon: { id: w.id, upgrades: w.gear?.upgrades ?? [] },
                carrier: w.carrier?.objectId ?? null,
                desired: fittingsOf(drafts[w.id]),
            })),
        );

    const guard = (go: () => void) => {
        if (drafted.length) setPrompt({ kind: "leave", go });
        else go();
    };
    const toSquad = () => guard(() => navigate(SQUAD));

    const switchTab = (next: Tab) => {
        uiTick(null);
        setFocusItem(null);
        setTab(next);
    };
    const onTab = (step: 1 | -1) => {
        if (data.gate !== null || data.accountId === null) return;
        const i = TABS.findIndex((t) => t.id === tab);
        switchTab(TABS[(i + step + TABS.length) % TABS.length].id);
    };

    const status = (
        <>
            <MatchChip match={data.match} onSearch={() => setPrompt({ kind: "search" })} />
            {data.saving ? (
                <StatusChip label="Records" value="Saving" state="busy" />
            ) : (
                drafted.length > 0 && (
                    <StatusChip
                        label="Mods"
                        value={drafted.length > 1 ? `${drafted.length} unsaved` : "Unsaved"}
                        tone="warn"
                    />
                )
            )}
        </>
    );

    const overlay =
        prompt?.kind === "leave" ? (
            <Prompt
                id="prompt-unsaved"
                eyebrow="Unsaved mods"
                title={
                    drafted.length > 1
                        ? `Apply mods to ${drafted.length} weapons?`
                        : `Apply mods to the ${drafted[0]?.name}?`
                }
                hint="Discard keeps the mods as they are"
                confirm={{
                    label: "Apply",
                    run: () => {
                        const go = prompt.go;
                        setPrompt(null);
                        void applyAll();
                        setDrafts({});
                        go();
                    },
                }}
                alternate={{
                    label: "Discard",
                    run: () => {
                        const go = prompt.go;
                        setPrompt(null);
                        setDrafts({});
                        go();
                    },
                }}
                cancel={{ label: "Keep fitting", run: () => setPrompt(null) }}
                glyphs={glyphs}
            >
                The new mods are lost unless they are applied.
            </Prompt>
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

    const frame: FrameBits = {
        status,
        overlay,
        glyphs,
        onLeave: () => guard(leave),
        onSwitch: toSquad,
        error: data.error,
        clearError: data.clearError,
    };

    return (
        <FocusRoot
            back={{ action: "back", label: "Leave", run: () => guard(leave) }}
            onTab={onTab}
            onSection={toSquad}
        >
            {data.gate !== null ? (
                <HqGateView section="armory" gate={data.gate} frame={frame} onSignIn={ops.signIn} />
            ) : data.accountId === null ? (
                <HqFrame section="armory" frame={frame} columns="minmax(0, 1fr)" focus="gate">
                    <EmptyState
                        id="gate-squad"
                        instant
                        group="gate"
                        headline="No squad on file"
                        action="Squad"
                        title="Squad"
                        hint="Hiring the free squad opens the armory"
                        commands={[
                            {
                                action: "confirm",
                                label: "Squad",
                                tone: "primary",
                                run: () => navigate(SQUAD),
                            },
                        ]}
                    >
                        The armory opens with your squad.
                    </EmptyState>
                </HqFrame>
            ) : (
                <Workspace
                    frame={frame}
                    tab={tab}
                    onTab={switchTab}
                    supply={supply}
                    setSupply={setSupply}
                    data={data}
                    ops={ops}
                    held={held}
                    mods={mods}
                    drafts={drafts}
                    setDrafts={setDrafts}
                    focusItem={focusItem}
                    onFocused={() => setFocusItem(null)}
                    jumpTo={(id) => {
                        setSupply(false);
                        setFocusItem(id);
                        setTab("weapons");
                    }}
                />
            )}
        </FocusRoot>
    );
}

// === The workspace ==========================================================

type WorkspaceProps = {
    frame: FrameBits;
    tab: Tab;
    onTab: (tab: Tab) => void;
    supply: boolean;
    setSupply: (on: boolean) => void;
    data: ArmoryData;
    ops: ArmoryOps;
    held: ReturnType<typeof heldEntries>;
    mods: ModEntry[];
    drafts: Record<string, Fit>;
    setDrafts: (change: (drafts: Record<string, Fit>) => Record<string, Fit>) => void;
    focusItem: string | null;
    onFocused: () => void;
    jumpTo: (weaponId: string) => void;
};

/** A stand-in wearer when the squad is empty: the first preset, unarmed. */
function standIn(armor: string): LocalRecruit {
    const base = presets.find((p) => p.sex === "male") ?? presets[0];
    return {
        id: "armory-stand-in",
        name: "",
        callsign: "",
        role: "Assault",
        appearance: normalize({ ...fromPreset(base), name: "" }, schema),
        armorColors: DEFAULT_ARMOR_COLORS,
        equipment: { primary: null, sidearm: null, armor, utility: null },
        attachments: {},
    };
}

function Workspace(props: WorkspaceProps) {
    const { frame, tab, supply, data, ops, held, mods, drafts, setDrafts } = props;
    const store = useFocusState();
    const wire = useWireframeAction();
    const images = useEquipmentImages();
    const recruits = data.recruits;
    const locals = useMemo(() => toLocalRecruits(recruits), [recruits]);
    const { portraits, studioHost } = useRecruitPortraits(locals);
    const [stage, setStage] = useState<{ loading: boolean; error?: string }>({ loading: true });
    const [picker, setPicker] = useState<Picker>(null);
    const [skins, setSkins] = useState(() => readWeaponSkins());
    const [skinPreview, setSkinPreview] = useState<string | null>(null);
    const pending = data.busy;

    const entries: (Entry | SupplyEntry)[] = supply
        ? SUPPLY[tab]
        : tab === "weapons"
          ? held.weapons
          : tab === "armor"
            ? held.armors
            : tab === "utilities"
              ? held.utilities
              : mods;

    // What the list's cursor was last on is the item on the stage and the bench.
    const remembered = store.remembered("list");
    const last = useRef<string | undefined>(undefined);
    if (entries.some((e) => rowId(e) === remembered)) last.current = remembered;
    const current = entries.find((e) => rowId(e) === last.current) ?? entries[0];
    const currentRow = current ? rowId(current) : undefined;

    // A new tab, the supply catalog or a deep link puts the cursor in the list.
    const { focusItem, onFocused } = props;
    useLayoutEffect(() => {
        setPicker(null);
        if (!focusItem) store.focusGroup("list");
    }, [store, tab, supply]);
    // A linked item takes the cursor once its row is there (its data may come later).
    useLayoutEffect(() => {
        if (!focusItem || !store.node(`item-${focusItem}`)) return;
        store.focus(`item-${focusItem}`, false);
        onFocused();
    });
    // A new item closes the picker and ends a finish preview.
    useEffect(() => {
        setPicker(null);
        setSkinPreview(null);
    }, [currentRow]);

    /** A write: refused while another is in flight. */
    const write = (label: string, run: () => unknown, extra?: Partial<Command>): Command => ({
        action: "confirm",
        label,
        tone: "primary",
        deny: pending ? "Still saving" : undefined,
        run: () => void run(),
        ...extra,
    });
    const toList: Command = {
        action: "back",
        label: supply ? "Requisition" : "Storage",
        run: () => store.focusGroup("list", true, true),
    };
    const closePicker = () => {
        setPicker(null);
        setSkinPreview(null);
        store.focusGroup("detail", true);
    };

    // The picker row under the cursor, previewed on the stage and in the stats.
    const focused = picker ? store.focused : null;
    const candidate = focused?.startsWith("pick-") ? focused.slice(5) : undefined;

    // --- The weapon on the bench -----------------------------------------------
    const weapon = current?.kind === "weapon" ? current : undefined;
    const fitted = useMemo(() => fitOf(weapon?.gear?.upgrades), [weapon]);
    const draft = (weapon && drafts[weapon.id]) || fitted;
    let shownFit = draft;
    if (weapon && picker?.kind === "mod" && candidate?.startsWith("mod-")) {
        const tier = candidate === "mod-none" ? null : Number(candidate.slice(4));
        const next = draftMod(draft, picker.slot, tier);
        if ("fit" in next) shownFit = next.fit;
    }
    const dirty = !!weapon && !sameFit(fitted, draft);
    const setDraft = (fit: Fit) => weapon && setDrafts((d) => ({ ...d, [weapon.id]: fit }));
    const discard = () =>
        weapon &&
        setDrafts((d) => {
            const next = { ...d };
            delete next[weapon.id];
            return next;
        });
    const stock = (data.storage.upgrades ?? []).map((u) => u.name);
    const apply = async () => {
        if (!weapon) return;
        const id = weapon.id;
        const sent = draft;
        const ok = await ops.applyFittings(
            { id, upgrades: weapon.gear?.upgrades ?? [] },
            weapon.carrier?.objectId ?? null,
            fittingsOf(sent),
        );
        if (ok)
            setDrafts((d) => {
                if (!d[id] || !sameFit(d[id], sent)) return d;
                const next = { ...d };
                delete next[id];
                return next;
            });
    };

    // --- The stage ---------------------------------------------------------------
    const skinModel = weapon ? stageModel(weapon.model) : undefined;
    const finishes = skinModel ? skinsFor(skinModel) : [];
    const savedSkin = weapon && skinModel ? validSkin(skinModel, skins[weapon.id]) : undefined;
    const shownSkin = skinPreview ?? savedSkin;

    // Armor is worn: by its carrier, by the recruit the issue picker points at,
    // else by the first recruit (a stand-in when the squad is empty).
    const armorModelId =
        current?.kind === "armor" || (current?.kind === "supply" && current.tab === "armor")
            ? current.model
            : undefined;
    const issueTarget =
        picker?.kind === "issue" && candidate?.startsWith("to-") ? candidate.slice(3) : undefined;
    const wearerId =
        (issueTarget && issueTarget !== "storage" ? issueTarget : undefined) ??
        (current?.kind === "armor" ? current.carrier?.objectId : undefined) ??
        recruits[0]?.objectId;
    const wearerLocal = locals.find((l) => l.id === wearerId);
    const wearer = useMemo<LocalRecruit | undefined>(() => {
        if (!armorModelId) return undefined;
        if (!wearerLocal) return standIn(armorModelId);
        return { ...wearerLocal, equipment: { ...wearerLocal.equipment, armor: armorModelId } };
    }, [armorModelId, wearerLocal]);
    const wearerName = recruits.find((r) => r.objectId === wearerId)?.metadata.name;

    // A mod is shown on a rifle: the one the try-on picker points at, else a Standard Rifle.
    const tryOn =
        picker?.kind === "tryon" && candidate?.startsWith("w-")
            ? held.weapons.find((w) => w.id === candidate.slice(2))
            : undefined;
    const modAttachment =
        current?.kind === "mod"
            ? current.attachment
            : current?.kind === "supply"
              ? current.attachment
              : undefined;

    let gear: { model?: Equipment["model"]; fit?: Fit; skin?: string } | null = null;
    if (weapon) gear = { model: stageModel(weapon.model), fit: shownFit, skin: shownSkin };
    else if (modAttachment) {
        if (tryOn) {
            const base = drafts[tryOn.id] ?? fitOf(tryOn.gear?.upgrades);
            gear = {
                model: stageModel(tryOn.model),
                fit: { ...base, [modAttachment.slot]: modAttachment.tier },
                skin: validSkin(stageModel(tryOn.model) ?? "rifle", skins[tryOn.id]),
            };
        } else gear = { model: "rifle", fit: { [modAttachment.slot]: modAttachment.tier } };
    } else if (current && !wearer && current.kind !== "mod")
        gear = { model: stageModel(current.model) };
    const gearFit = gear?.fit;
    const gearAttachments = useMemo(
        () => (gearFit ? fitAttachments(gearFit) : {}),
        [JSON.stringify(gearFit ?? {})],
    );

    const carrierOf = (e: Entry | SupplyEntry | undefined) =>
        e && e.kind !== "mod" && e.kind !== "supply" ? e.carrier : null;
    const caption = current && (
        <>
            <span className="gui-stage-eyebrow">
                {current.kind === "supply"
                    ? "Requisition"
                    : wearer && wearerName
                      ? current.kind === "armor" && current.carrier?.objectId === wearerId
                          ? `Worn by ${wearerName}`
                          : `On ${wearerName}`
                      : current.kind === "mod"
                        ? `On the ${tryOn?.name ?? "Standard Rifle"}`
                        : carrierOf(current)
                          ? `Carried by ${carrierOf(current)!.metadata.name}`
                          : "In storage"}
            </span>
            <span className="gui-stage-title" key={currentRow}>
                {current.name}
            </span>
            {dirty && <span className="gui-stage-tag">Draft</span>}
        </>
    );

    const stageKey = wearer ? "character" : gear?.model ? "gear" : "none";
    const stagePanel = (
        <StagePanel
            key={stageKey}
            actions={[wire]}
            id="stage"
            group="stage"
            label="Stage"
            loading={stageKey !== "none" && stage.loading}
            error={stage.error}
            back={toList}
            caption={caption}
        >
            {wearer ? (
                <CharacterCanvas
                    recruit={wearer}
                    appearance={wearer.appearance}
                    onState={setStage}
                />
            ) : gear?.model ? (
                <GearCanvas
                    model={gear.model}
                    attachments={gearAttachments}
                    skin={gear.skin}
                    onState={setStage}
                />
            ) : (
                <div className="gui-void hqa-stage-void">
                    <span className="gui-void-mark" aria-hidden />
                </div>
            )}
        </StagePanel>
    );

    // --- The list ------------------------------------------------------------------
    const select = (e: Entry | SupplyEntry): Command =>
        rowId(e) === currentRow
            ? {
                  action: "confirm",
                  label: "Inspect",
                  tone: "primary",
                  run: () => store.focusGroup("detail", true, true),
              }
            : {
                  action: "confirm",
                  label: "Select",
                  tone: "primary",
                  run: () => store.focus(rowId(e)),
              };
    const toStorage: Command = {
        action: "back",
        label: "Storage",
        run: () => props.setSupply(false),
    };
    const openSupply: Command = {
        action: "confirm",
        label: "Requisition",
        tone: "primary",
        run: () => props.setSupply(true),
    };

    const listRow = (e: Entry | SupplyEntry) => {
        const id = rowId(e);
        const thumbIcon =
            SLOT_ICON[e.kind === "armor" ? "armor" : e.kind === "utility" ? "utility" : "primary"];
        if (e.kind === "supply")
            return (
                <ListRow
                    key={id}
                    id={id}
                    group="list"
                    thumb={<Thumb src={images[e.model ?? ""]} icon={thumbIcon} />}
                    name={e.name}
                    kind={e.attachment ? modifierSummary(unpack(e.attachment.packed)) : undefined}
                    selected={id === currentRow}
                    title={e.name}
                    hint="Into storage, free"
                    commands={[write("Requisition", () => ops.requisition(e.order)), toStorage]}
                />
            );
        if (e.kind === "mod")
            return (
                <ListRow
                    key={id}
                    id={id}
                    instant
                    group="list"
                    thumb={<Thumb src={images[e.id]} icon={thumbIcon} />}
                    name={e.name}
                    kind={modifierSummary(unpack(e.attachment.packed))}
                    tag={e.stock ? `×${e.stock}` : "Fitted"}
                    tagTone={e.stock ? "default" : "accent"}
                    selected={id === currentRow}
                    title={e.name}
                    hint={
                        e.fittedOn.length
                            ? `Fitted on ${e.fittedOn.length} · ${e.stock} in storage`
                            : `${e.stock} in storage`
                    }
                    commands={[select(e)]}
                />
            );
        const isDrafted =
            e.kind === "weapon" &&
            !!drafts[e.id] &&
            !sameFit(fitOf(e.gear?.upgrades), drafts[e.id]);
        const count = e.gear?.upgrades?.length ?? 0;
        return (
            <ListRow
                key={id}
                id={id}
                instant
                group="list"
                thumb={<Thumb src={images[e.model ?? ""]} icon={thumbIcon} />}
                name={e.name}
                kind={
                    e.kind === "weapon" && count
                        ? `${count} ${count === 1 ? "mod" : "mods"}`
                        : undefined
                }
                tag={isDrafted ? "Draft" : e.carrier?.metadata.name.split(/\s+/)[0]}
                tagTone={isDrafted ? "warn" : "accent"}
                selected={id === currentRow}
                title={e.name}
                hint={
                    e.carrier
                        ? `${e.kind === "armor" ? "Worn" : "Carried"} by ${e.carrier.metadata.name}`
                        : "In storage"
                }
                commands={[select(e)]}
            />
        );
    };

    const list = (
        <Panel className="hqa-list">
            {supply && <Eyebrow meta="Free">Requisition</Eyebrow>}
            <List label={supply ? "Requisition" : "Storage"}>
                {entries.map(listRow)}
                {!supply && entries.length > 0 && (
                    <ListRow
                        id="row-supply"
                        instant
                        group="list"
                        thumb={<Thumb />}
                        name="Requisition"
                        title="Requisition"
                        hint="New gear into storage, free"
                        commands={[openSupply]}
                    />
                )}
            </List>
            {!supply && entries.length === 0 && (
                <EmptyState
                    id="list-empty"
                    instant
                    group="list"
                    headline="Nothing in storage"
                    action="Requisition"
                    title="Requisition"
                    hint="New gear into storage, free"
                    commands={[openSupply]}
                >
                    Requisition gear to fit and issue it.
                </EmptyState>
            )}
        </Panel>
    );

    // --- The bench --------------------------------------------------------------------
    const holderFor = (kind: "weapon" | "armor" | "utility", r: ChainRecruit): Holder => ({
        id: r.objectId,
        name: r.metadata.name,
        holding:
            kind === "weapon"
                ? r.weapon
                    ? [{ id: r.weapon.id, name: weaponName(r.weapon) }]
                    : []
                : kind === "armor"
                  ? r.armor
                      ? [{ id: r.armor.id, name: r.armor.name }]
                      : []
                  : r.utilities.map((u) => ({ id: u.id, name: u.name })),
    });

    /** Who carries it, Issue (a picker) and Return; refused while a weapon has a draft. */
    const carrierRow = (e: HeldEntry) => {
        const lock = dirty ? "Apply or discard the mods first" : undefined;
        const ret = () =>
            e.kind === "utility"
                ? ops.unequipUtility(e.carrier!.objectId, e.id)
                : ops.unequip(e.kind, e.carrier!.objectId);
        return (
            <SlotRow
                id="bench-carrier"
                instant
                group="detail"
                slot={e.carrier ? (e.kind === "armor" ? "Worn by" : "Carried by") : "Storage"}
                image={e.carrier ? portraits[e.carrier.objectId] : undefined}
                item={e.carrier?.metadata.name ?? "Not issued"}
                title={e.carrier ? e.carrier.metadata.name : "In storage"}
                hint={
                    e.carrier
                        ? "Issue to another recruit, or return it to storage"
                        : "Issue to a recruit"
                }
                commands={[
                    ...(e.carrier
                        ? [
                              write("Return", ret, {
                                  action: "reset",
                                  tone: undefined,
                                  deny: lock ?? (pending ? "Still saving" : undefined),
                              }),
                          ]
                        : []),
                    {
                        action: "confirm",
                        label: "Issue",
                        tone: "primary",
                        deny: lock,
                        run: () => setPicker({ kind: "issue" }),
                    },
                    toList,
                ]}
            />
        );
    };

    const description = (name: string) => {
        const text = describe(name);
        return text ? <p className="gui-note hqa-note">{text}</p> : null;
    };

    const armorRows = (modifier: Stats, name: string) =>
        VISIBLE.filter((row) => ARMOR_KEYS.includes(row.key)).map((row) => (
            <StatRow
                key={row.key}
                id={`stat-${row.key}`}
                group="detail"
                label={row.label}
                icon={STAT_ICON[row.key]}
                value={RECRUIT_DEFAULT[row.key] + modifier[row.key]}
                base={RECRUIT_DEFAULT[row.key]}
                // The result floors at zero the way the field does; the delta keeps the nerf.
                text={formatStat(row, add(RECRUIT_DEFAULT, modifier))}
                max={row.max}
                title={row.label}
                hint={
                    modifier[row.key]
                        ? `${name} ${signedText(modifier[row.key], row.unit)} on a recruit's ${RECRUIT_DEFAULT[row.key]}`
                        : `A recruit's own ${RECRUIT_DEFAULT[row.key]}`
                }
                commands={[toList]}
            />
        ));

    const weaponRows = (base: Stats, now: Stats, next: Stats, compare: boolean) =>
        WEAPON_KEYS.map((key) => VISIBLE.find((row) => row.key === key)!)
            .filter((row) => row.key !== "aim" || base.aim || now.aim || next.aim)
            .map((row) => {
                const k = row.key;
                const parts = [`Base ${formatStat(row, base)}`];
                if (now[k] !== base[k])
                    parts.push(`mods ${signedText(now[k] - base[k], row.unit)}`);
                if (next[k] !== now[k])
                    parts.push(`draft ${signedText(next[k] - now[k], row.unit)}`);
                return (
                    <StatRow
                        key={k}
                        id={`stat-${k}`}
                        group="detail"
                        label={row.label}
                        icon={STAT_ICON[k]}
                        value={next[k]}
                        base={compare ? now[k] : base[k]}
                        text={formatStat(row, next)}
                        max={row.max}
                        title={row.label}
                        hint={parts.join(" · ")}
                        commands={[toList]}
                    />
                );
            });

    const bench = () => {
        if (!current)
            return (
                <div className="gui-void">
                    <span className="gui-void-mark" aria-hidden />
                </div>
            );
        if (current.kind === "supply") {
            const model = current.model ?? "";
            return (
                <div className="hqs-stack" key={currentRow}>
                    {current.tab === "weapons" &&
                        weaponRows(
                            ITEM_STATS[model] ?? EMPTY,
                            ITEM_STATS[model] ?? EMPTY,
                            ITEM_STATS[model] ?? EMPTY,
                            false,
                        )}
                    {current.tab === "armor" && armorRows(ITEM_STATS[model] ?? EMPTY, current.name)}
                    {current.attachment && (
                        <ReadoutLine label="Effect">
                            {modifierSummary(unpack(current.attachment.packed))}
                        </ReadoutLine>
                    )}
                    {current.actions &&
                        grants(current.actions).map((g) => (
                            <ReadoutLine key={g} label="Grants">
                                {g}
                            </ReadoutLine>
                        ))}
                    {description(current.name)}
                </div>
            );
        }
        if (current.kind === "mod") {
            const a = current.attachment;
            return (
                <div className="hqs-stack" key={currentRow}>
                    <ReadoutLine label="Storage">{current.stock}</ReadoutLine>
                    {current.fittedOn.map((w) => (
                        <ReadoutLine key={w.id} label="Fitted on">
                            {w.name}
                            {w.carrier ? ` · ${w.carrier.metadata.name}` : ""}
                        </ReadoutLine>
                    ))}
                    {description(a.name)}
                    <ActionRow
                        id="bench-tryon"
                        instant
                        group="detail"
                        label="Try on a weapon"
                        title={a.name}
                        hint="Drafts it on a weapon's bench"
                        commands={[
                            {
                                action: "confirm",
                                label: "Try on",
                                tone: "primary",
                                deny: held.weapons.length ? undefined : "No weapon to fit it on",
                                run: () => setPicker({ kind: "tryon" }),
                            },
                            toList,
                        ]}
                    />
                </div>
            );
        }
        if (current.kind === "armor") {
            return (
                <div className="hqs-stack" key={currentRow}>
                    {armorRows(armorStats(current.gear!), current.name)}
                    {description(current.name)}
                    {carrierRow(current)}
                </div>
            );
        }
        if (current.kind === "utility") {
            const u = current.utility!;
            return (
                <div className="hqs-stack" key={currentRow}>
                    {utilityGrants(u).map((g) => (
                        <ReadoutLine key={g} label="Grants">
                            {g}
                        </ReadoutLine>
                    ))}
                    {utilityModifiers(u).map((m) => (
                        <ReadoutLine key={m.label} label={m.label}>
                            {m.value}
                        </ReadoutLine>
                    ))}
                    {description(current.name)}
                    {carrierRow(current)}
                </div>
            );
        }
        // A weapon: stats, the four mod slots, the draft's changes, finish, carrier.
        const w = current;
        const profile = weaponView(w.gear!, shownFit);
        const drafting = !sameFit(fitted, shownFit);
        const plan = fitPlan(
            (w.gear?.upgrades ?? []).map((u) => u.name),
            draft,
            stock,
        );
        const lines = weaponView(w.gear!, draft).lines;
        const skinName = finishes.find((s) => s.id === savedSkin)?.name;
        return (
            <List label="Bench" key={currentRow}>
                {weaponRows(profile.base, profile.now, profile.next, drafting)}
                <div className="hqs-gap" />
                <Eyebrow meta={`${fitCount(draft)} / ${MAX_FITTINGS}`}>Mods</Eyebrow>
                {MOD_SLOTS.map((slot) => {
                    const a = draft[slot] ? attachmentFor(slot, draft[slot]!) : undefined;
                    const changed = (draft[slot] ?? 0) !== (fitted[slot] ?? 0);
                    const full = !a && fitCount(draft) >= MAX_FITTINGS;
                    return (
                        <SlotRow
                            key={slot}
                            id={`slot-${slot}`}
                            instant
                            group="detail"
                            slot={
                                changed
                                    ? `${ATTACHMENT_SLOT_NAMES[slot]} · draft`
                                    : ATTACHMENT_SLOT_NAMES[slot]
                            }
                            image={a ? images[a.id] : undefined}
                            icon={SLOT_ICON.primary}
                            item={a?.name}
                            title={ATTACHMENT_SLOT_NAMES[slot]}
                            hint={a ? modifierSummary(unpack(a.packed)) : "One of each kind"}
                            commands={[
                                ...(a
                                    ? [
                                          {
                                              action: "reset" as const,
                                              label: "Clear",
                                              run: () => {
                                                  const next = draftMod(draft, slot, null);
                                                  if ("fit" in next) setDraft(next.fit);
                                              },
                                          },
                                      ]
                                    : []),
                                {
                                    action: "confirm",
                                    label: a ? "Change" : "Fit",
                                    tone: "primary",
                                    deny: full ? LIMIT_REASON : undefined,
                                    run: () => setPicker({ kind: "mod", slot }),
                                },
                                toList,
                            ]}
                        />
                    );
                })}
                {dirty && (
                    <>
                        {lines.map((l) => (
                            <ReadoutLine
                                key={`${l.state}-${l.name}`}
                                label={
                                    l.state === "fitted"
                                        ? "Fitted"
                                        : l.state === "drafted"
                                          ? "Draft"
                                          : "Off"
                                }
                            >
                                <span className="hqa-line" data-state={l.state}>
                                    {l.name} · {modifierSummary(l.modifier)}
                                </span>
                            </ReadoutLine>
                        ))}
                        <ActionRow
                            id="bench-apply"
                            group="detail"
                            label="Apply mods"
                            title="Apply mods"
                            hint={planSummary(plan)}
                            commands={[
                                write("Apply", apply),
                                { action: "reset", label: "Discard", run: discard },
                                toList,
                            ]}
                        />
                    </>
                )}
                {finishes.length > 1 && (
                    <>
                        <div className="hqs-gap" />
                        <SlotRow
                            id="bench-finish"
                            instant
                            group="detail"
                            slot="Finish"
                            item={skinName}
                            title="Finish"
                            hint="Kept on this device"
                            commands={[
                                {
                                    action: "confirm",
                                    label: "Change",
                                    tone: "primary",
                                    run: () => setPicker({ kind: "finish" }),
                                },
                                toList,
                            ]}
                        />
                    </>
                )}
                <div className="hqs-gap" />
                {carrierRow(w)}
            </List>
        );
    };

    // --- Pickers ------------------------------------------------------------------------
    const back: Command = { action: "back", label: "Bench", run: closePicker };
    const pickerBody = () => {
        if (!picker || !current) return null;
        if (picker.kind === "finish" && weapon && skinModel)
            return (
                <GridPicker
                    id="finish"
                    title="Finish"
                    options={finishes.map((s) => ({ id: s.id, label: s.name, colors: s.swatch }))}
                    value={savedSkin ?? "factory"}
                    columns={2}
                    onPreview={setSkinPreview}
                    onPick={(id) => {
                        setSkins(saveWeaponSkin(weapon.id, id));
                        closePicker();
                    }}
                    onClose={closePicker}
                />
            );
        if (picker.kind === "mod" && weapon) {
            const slot = picker.slot;
            const tiers = [1, 2, 3].map((t) => attachmentFor(slot, t)!);
            const inStock = (id: string) =>
                (data.storage.upgrades ?? []).filter(
                    (u) => u.name === tiers.find((a) => a.id === id)?.name,
                ).length;
            return (
                <FocusScope id="picker" back={back}>
                    <div className="hqs-stack">
                        <Eyebrow meta={`${fitCount(draft)} / ${MAX_FITTINGS}`}>
                            {ATTACHMENT_SLOT_NAMES[slot]}
                        </Eyebrow>
                        <List label={ATTACHMENT_SLOT_NAMES[slot]}>
                            {draft[slot] && (
                                <ListRow
                                    id="pick-mod-none"
                                    group="picker"
                                    thumb={<Thumb icon={SLOT_ICON.primary} />}
                                    name="None"
                                    title="None"
                                    hint="Comes off when the mods are applied"
                                    commands={[
                                        {
                                            action: "confirm",
                                            label: "Choose",
                                            tone: "primary",
                                            run: () => {
                                                const next = draftMod(draft, slot, null);
                                                if ("fit" in next) setDraft(next.fit);
                                                closePicker();
                                            },
                                        },
                                        back,
                                    ]}
                                />
                            )}
                            {tiers.map((a) => {
                                const next = draftMod(draft, slot, a.tier);
                                const on = fitted[slot] === a.tier;
                                const count = inStock(a.id);
                                return (
                                    <ListRow
                                        key={a.id}
                                        id={`pick-mod-${a.tier}`}
                                        group="picker"
                                        thumb={
                                            <Thumb src={images[a.id]} icon={SLOT_ICON.primary} />
                                        }
                                        name={a.name}
                                        kind={modifierSummary(unpack(a.packed))}
                                        tag={on ? "Fitted" : count ? `×${count}` : "Free"}
                                        tagTone={on ? "accent" : "default"}
                                        selected={draft[slot] === a.tier}
                                        title={a.name}
                                        hint={
                                            on
                                                ? "On the weapon now"
                                                : count
                                                  ? "From storage when applied"
                                                  : "Requisitioned when applied, free"
                                        }
                                        commands={[
                                            {
                                                action: "confirm",
                                                label: "Choose",
                                                tone: "primary",
                                                deny: "deny" in next ? next.deny : undefined,
                                                run: () => {
                                                    if ("fit" in next) setDraft(next.fit);
                                                    closePicker();
                                                },
                                            },
                                            back,
                                        ]}
                                    />
                                );
                            })}
                        </List>
                        <StatChanges
                            before={weaponView(weapon.gear!, draft).next}
                            after={weaponView(weapon.gear!, shownFit).next}
                            label="If chosen"
                        />
                    </div>
                </FocusScope>
            );
        }
        if (picker.kind === "tryon" && current.kind === "mod") {
            const a = current.attachment;
            return (
                <FocusScope id="picker" back={{ ...back, label: "Mod" }}>
                    <div className="hqs-stack">
                        <Eyebrow>Try on</Eyebrow>
                        <List label="Weapons">
                            {held.weapons.map((w) => {
                                const fit = drafts[w.id] ?? fitOf(w.gear?.upgrades);
                                const next = draftMod(fit, a.slot, a.tier);
                                const deny =
                                    fit[a.slot] === a.tier
                                        ? "Already fitted"
                                        : "deny" in next
                                          ? next.deny
                                          : undefined;
                                return (
                                    <ListRow
                                        key={w.id}
                                        id={`pick-w-${w.id}`}
                                        group="picker"
                                        thumb={
                                            <Thumb
                                                src={images[w.model ?? ""]}
                                                icon={SLOT_ICON.primary}
                                            />
                                        }
                                        name={w.name}
                                        kind={w.carrier?.metadata.name}
                                        title={w.name}
                                        hint={
                                            fit[a.slot] && fit[a.slot] !== a.tier
                                                ? `Replaces the ${attachmentFor(a.slot, fit[a.slot]!)?.name}`
                                                : "Opens its bench with the mod drafted"
                                        }
                                        commands={[
                                            {
                                                action: "confirm",
                                                label: "Try on",
                                                tone: "primary",
                                                deny,
                                                run: () => {
                                                    if (!("fit" in next)) return;
                                                    setDrafts((d) => ({ ...d, [w.id]: next.fit }));
                                                    setPicker(null);
                                                    props.jumpTo(w.id);
                                                },
                                            },
                                            { ...back, label: "Mod" },
                                        ]}
                                    />
                                );
                            })}
                        </List>
                    </div>
                </FocusScope>
            );
        }
        if (picker.kind === "issue" && current.kind !== "mod" && current.kind !== "supply") {
            const e = current;
            const done = (run: () => Promise<boolean>) => () => {
                closePicker();
                return run();
            };
            const ret = () =>
                e.kind === "utility"
                    ? ops.unequipUtility(e.carrier!.objectId, e.id)
                    : ops.unequip(e.kind, e.carrier!.objectId);
            const none =
                e.kind === "weapon" ? "Unarmed" : e.kind === "armor" ? "No armor" : "No utility";
            return (
                <FocusScope id="picker" back={back}>
                    <div className="hqs-stack">
                        <Eyebrow>Issue to</Eyebrow>
                        <List label="Issue to">
                            {e.carrier && (
                                <ListRow
                                    id="pick-to-storage"
                                    group="picker"
                                    thumb={
                                        <Thumb
                                            icon={
                                                SLOT_ICON[e.kind === "weapon" ? "primary" : e.kind]
                                            }
                                        />
                                    }
                                    name="Storage"
                                    title="Storage"
                                    hint={`Off ${e.carrier.metadata.name}, back into storage`}
                                    commands={[write("Return", done(ret)), back]}
                                />
                            )}
                            {recruits.map((r) => {
                                const holder = holderFor(e.kind, r);
                                const plan = issueTo(
                                    e.kind,
                                    e.id,
                                    e.carrier?.objectId ?? null,
                                    holder,
                                    MAX_UTILITIES,
                                );
                                const run = () =>
                                    plan.verb === "Carrying"
                                        ? Promise.resolve(true)
                                        : e.kind === "utility"
                                          ? ops.issueUtility(
                                                e.id,
                                                plan.from,
                                                r.objectId,
                                                plan.replace,
                                            )
                                          : ops.issue(e.kind, e.id, plan.from, r.objectId);
                                const hint =
                                    plan.verb === "Carrying"
                                        ? "Carrying it now"
                                        : [
                                              plan.from
                                                  ? `Off ${e.carrier!.metadata.name}`
                                                  : "From storage",
                                              plan.returns && `${plan.returns} goes to storage`,
                                          ]
                                              .filter(Boolean)
                                              .join(" · ");
                                return (
                                    <ListRow
                                        key={r.objectId}
                                        id={`pick-to-${r.objectId}`}
                                        group="picker"
                                        thumb={
                                            <Portrait
                                                src={portraits[r.objectId]}
                                                rank={r.rank.$kind}
                                            />
                                        }
                                        name={r.metadata.name}
                                        kind={holder.holding.map((h) => h.name).join(", ") || none}
                                        tag={plan.verb === "Carrying" ? "Carrying" : undefined}
                                        tagTone="accent"
                                        selected={plan.verb === "Carrying"}
                                        title={r.metadata.name}
                                        hint={hint}
                                        commands={
                                            plan.verb === "Carrying"
                                                ? [back]
                                                : [write(plan.verb, done(run)), back]
                                        }
                                    />
                                );
                            })}
                        </List>
                        {recruits.length === 0 && <p className="gui-note">No recruits on file.</p>}
                    </div>
                </FocusScope>
            );
        }
        return null;
    };

    return (
        <HqFrame
            section="armory"
            frame={frame}
            tabs={
                <Tabs
                    tabs={TABS}
                    active={tab}
                    onSelect={(id) => props.onTab(id as Tab)}
                    glyphs={frame.glyphs}
                />
            }
            columns={COLUMNS}
        >
            {list}
            {stagePanel}
            <Panel className="hqa-bench">{picker ? pickerBody() : bench()}</Panel>
            <Offstage ref={studioHost} />
        </HqFrame>
    );
}

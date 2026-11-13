// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * HQ / Squad in the sample's language: the roster on the left, the selected
 * operative on the game's own character stage, and an inspector on the right
 * whose four sections (Loadout, Stats, Appearance, Dossier) are the header's
 * tabs. Everything is local: the roster is the showcase squad /demo plays
 * with, read once and never written back.
 */

import { initialSquad, savedRecruits, SQUAD_STORAGE_KEY } from "@ghosts/squad/model";
import { recruitStats } from "@ghosts/squad/stats";
import type { Appearance, ArmorColors, Recruit, Slot } from "@ghosts/squad/types";
import {
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type ComponentProps,
    type ReactNode,
} from "react";

import { previewVoice } from "../../audio";
import { useEquipmentImages } from "../headquarters/equipmentImages";
import { useRecruitPortraits } from "../squad/useRecruitPortraits";
import {
    ActionRow,
    Eyebrow,
    FocusCommandBar,
    FocusScope,
    List,
    ListRow,
    Panel,
    Prompt,
    ScreenFrame,
    SLOT_ICON,
    SlotRow,
    StagePanel,
    Stepper,
    Tabs,
    Thumb,
    useFocusState,
    type Command,
    type GlyphSet,
    type TabDef,
} from "../../ui";
import { AppearanceEditor, HEAD_SECTIONS } from "../headquarters/squad/AppearanceEditor";
import { CharacterCanvas, useWireframeAction } from "../headquarters/squad/CharacterCanvas";
import {
    Offstage,
    Portrait,
    RankMark,
    RankProgress,
    SquadStats,
    StatChanges,
} from "../headquarters/squad/parts";
import {
    fixtureRank,
    gearName,
    ITEMS,
    LOADOUT_SLOT_NAMES,
    LOADOUT_SLOTS,
    realLoadout,
    SLOT_ITEMS,
} from "./data";

export type SquadTab = "loadout" | "stats" | "appearance" | "dossier";

export const SQUAD_TABS: TabDef[] = [
    { id: "loadout", label: "Loadout" },
    { id: "stats", label: "Stats" },
    { id: "appearance", label: "Appearance" },
    { id: "dossier", label: "Dossier" },
];

// === State ===============================================================

type Look = { appearance: Appearance; armorColors: ArmorColors };

/** The local roster, the operative on stage, and an unsaved appearance draft. */
/**
 * `?long=1`: the roster padded to 40 with numbered copies of the showcase
 * operatives — the long-list proof for the shared `List` (it scrolls inside
 * its panel, following the cursor). Never written anywhere.
 */
function longRoster(recruits: Recruit[]): Recruit[] {
    if (new URLSearchParams(window.location.search).get("long") !== "1" || !recruits.length)
        return recruits;
    return Array.from({ length: 40 }, (_, i) => {
        const r = recruits[i % recruits.length];
        return i < recruits.length
            ? r
            : { ...r, id: `${r.id}-copy-${i}`, callsign: `${r.callsign}-${i + 1}` };
    });
}

export function useSquadState() {
    const [roster, setRoster] = useState<Recruit[]>(() =>
        longRoster(
            (savedRecruits(localStorage.getItem(SQUAD_STORAGE_KEY)) ?? initialSquad().recruits).map(
                realLoadout,
            ),
        ),
    );
    const [selected, setSelected] = useState(() => roster[0]?.id ?? "");
    const [draft, setDraft] = useState<Look | null>(null);
    const [voices, setVoices] = useState<Record<string, number>>({});
    const recruit = roster.find((r) => r.id === selected) ?? roster[0];
    const dirty =
        !!draft &&
        !!recruit &&
        (JSON.stringify(draft.appearance) !== JSON.stringify(recruit.appearance) ||
            JSON.stringify(draft.armorColors) !== JSON.stringify(recruit.armorColors));
    const update = (id: string, change: (r: Recruit) => Recruit) =>
        setRoster((list) => list.map((r) => (r.id === id ? change(r) : r)));
    return {
        roster,
        recruit,
        draft,
        dirty,
        /** The look on stage: the draft while editing, the saved one otherwise. */
        look: (draft ?? {
            appearance: recruit?.appearance,
            armorColors: recruit?.armorColors,
        }) as Look,
        select(id: string) {
            setDraft(null);
            setSelected(id);
        },
        edit(patch: Partial<Appearance>, colors?: ArmorColors) {
            if (!recruit) return;
            setDraft((d) => {
                const base = d ?? {
                    appearance: recruit.appearance,
                    armorColors: recruit.armorColors,
                };
                return {
                    appearance: { ...base.appearance, ...patch },
                    armorColors: colors ?? base.armorColors,
                };
            });
        },
        save() {
            if (!draft || !recruit) return;
            update(recruit.id, (r) => ({ ...r, ...draft }));
            setDraft(null);
        },
        discard() {
            setDraft(null);
        },
        equip(slot: Slot, item: string | null) {
            if (!recruit) return;
            update(recruit.id, (r) => ({
                ...r,
                equipment: { ...r.equipment, [slot]: item },
                // A new primary arrives bare; its fittings stay with the old one.
                attachments: slot === "primary" ? {} : r.attachments,
            }));
        },
        /** Re-equip an operative with a whole build (a squad preset). */
        setLoadout(
            id: string,
            loadout: {
                primary: string | null;
                armor: string | null;
                utility: string | null;
                mods: Recruit["attachments"];
            },
        ) {
            update(id, (r) => ({
                ...r,
                equipment: {
                    ...r.equipment,
                    primary: loadout.primary,
                    armor: loadout.armor,
                    utility: loadout.utility,
                },
                attachments: { ...loadout.mods },
            }));
        },
        dismiss(id: string) {
            const rest = roster.filter((r) => r.id !== id);
            setDraft(null);
            setRoster(rest);
            setSelected(rest[0]?.id ?? "");
        },
        /** Rank and experience: fixtures by roster position (the local roster has neither). */
        rank: (id: string) =>
            fixtureRank(
                Math.max(
                    0,
                    roster.findIndex((r) => r.id === id),
                ),
            ),
        voice: (id: string) => voices[id] ?? 0,
        setVoice: (id: string, voice: number) => setVoices((v) => ({ ...v, [id]: voice })),
    };
}

export type SquadState = ReturnType<typeof useSquadState>;

// === Screen ==============================================================

type Props = {
    squad: SquadState;
    tab: SquadTab;
    onTab: (tab: SquadTab) => void;
    glyphs: GlyphSet;
    /** The header's shared slots, from the screen root. */
    frame: {
        siblings: ComponentProps<typeof ScreenFrame>["siblings"];
        status: ReactNode;
        onLeave: () => void;
        overlay: ReactNode;
    };
    /** Run `go` now, or after the unsaved-changes prompt is answered. */
    guard: (go: () => void) => void;
    save: () => void;
};

type LocalPrompt = { kind: "dismiss"; recruit: Recruit } | null;

export function Squad({ squad, tab, onTab, glyphs, frame, guard, save }: Props) {
    const store = useFocusState();
    const wire = useWireframeAction();
    const [stage, setStage] = useState<{ loading: boolean; error?: string }>({ loading: true });
    const [picker, setPicker] = useState<(typeof LOADOUT_SLOTS)[number] | null>(null);
    const [prompt, setPrompt] = useState<LocalPrompt>(null);
    /** A grid tile under the cursor, worn on top of the draft. */
    const [lookPreview, setLookPreview] = useState<Partial<Appearance> | null>(null);
    /** The appearance editor is on a head section: the stage frames the face. */
    const [face, setFace] = useState(false);
    const { recruit, roster } = squad;
    const images = useEquipmentImages();
    const { portraits, studioHost } = useRecruitPortraits(roster);

    // A new tab puts the cursor on the inspector's first row; entering the
    // screen puts it on the roster.
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

    // The picker previews the focused item on the operative.
    const pickerFocus = picker ? store.node(store.focused)?.id : undefined;
    const candidate =
        picker && pickerFocus?.startsWith("pick-")
            ? pickerFocus.slice("pick-".length).replace(/^none$/, "")
            : undefined;
    const onStage = useMemo(() => {
        if (!recruit) return undefined;
        const r = { ...recruit, armorColors: squad.look.armorColors };
        if (picker && candidate !== undefined)
            r.equipment = { ...r.equipment, [picker]: candidate || null };
        return r;
    }, [recruit, squad.look.armorColors, picker, candidate]);

    const toRoster: Command = {
        action: "back",
        label: "Roster",
        run: () => store.focusGroup("list", true, true),
    };

    if (!recruit || !onStage) return null;

    const look = squad.look;
    const { rank, xp } = squad.rank(recruit.id);
    const voiceIds = [0, 1, 2, 3].map((i) => i * 2 + (look.appearance.sex === "female" ? 1 : 0));
    const voice = voiceIds.includes(squad.voice(recruit.id))
        ? squad.voice(recruit.id)
        : voiceIds[0];

    const inspector = () => {
        switch (tab) {
            case "loadout":
                return LOADOUT_SLOTS.map((slot) => {
                    const id = onStage.equipment[slot];
                    const item = id ? ITEMS[id] : undefined;
                    return (
                        <SlotRow
                            key={slot}
                            id={`slot-${slot}`}
                            instant
                            group="inspector"
                            slot={LOADOUT_SLOT_NAMES[slot]}
                            icon={SLOT_ICON[slot]}
                            image={item ? images[item.id] : undefined}
                            item={item?.name}
                            title={LOADOUT_SLOT_NAMES[slot]}
                            hint={item ? item.effect : "Nothing issued"}
                            commands={[
                                {
                                    action: "confirm",
                                    label: "Change",
                                    tone: "primary",
                                    run: () => setPicker(slot),
                                },
                                ...(slot === "utility" && item
                                    ? ([
                                          {
                                              action: "reset",
                                              label: "Unequip",
                                              run: () => {
                                                  squad.equip(slot, null);
                                                  save();
                                              },
                                          },
                                      ] satisfies Command[])
                                    : []),
                                toRoster,
                            ]}
                        />
                    );
                });
            case "stats":
                return (
                    <SquadStats
                        recruit={onStage}
                        weaponName={gearName(onStage.equipment.primary) ?? "Unarmed"}
                        names={Object.fromEntries(
                            Object.values(ITEMS).map((item) => [item.wear ?? item.id, item.name]),
                        )}
                        commands={[toRoster]}
                    />
                );
            case "appearance":
                return (
                    <AppearanceEditor
                        look={look}
                        dirty={squad.dirty}
                        edit={squad.edit}
                        preview={setLookPreview}
                        save={() => {
                            squad.save();
                            save();
                        }}
                        discard={squad.discard}
                        onSection={(section) => setFace(HEAD_SECTIONS.has(section))}
                        toRoster={toRoster}
                    />
                );
            case "dossier":
                return (
                    <>
                        <RankProgress rank={rank} xp={xp} />
                        <Stepper
                            id="dossier-voice"
                            group="inspector"
                            label="Voice"
                            options={voiceIds.map((id, i) => [
                                String(id),
                                `Take ${String(i + 1).padStart(2, "0")}`,
                            ])}
                            value={String(voice)}
                            onChange={(id) => squad.setVoice(recruit.id, Number(id))}
                            title="Voice"
                            hint="What they say on the field radio"
                            commands={[
                                { action: "nav", label: "Change", glyph: "lr" },
                                {
                                    action: "confirm",
                                    label: "Audition",
                                    tone: "primary",
                                    run: () => previewVoice(voice),
                                },
                                toRoster,
                            ]}
                        />
                        <ActionRow
                            id="dossier-dismiss"
                            group="inspector"
                            label={`Dismiss ${recruit.callsign}`}
                            tone="danger"
                            title="Dismiss"
                            hint="Ends the contract for good; their gear returns to the armory"
                            commands={[
                                {
                                    action: "confirm",
                                    label: "Dismiss",
                                    tone: "danger",
                                    deny:
                                        roster.length < 2
                                            ? "The squad needs at least one operative"
                                            : undefined,
                                    run: () => setPrompt({ kind: "dismiss", recruit }),
                                },
                                toRoster,
                            ]}
                        />
                    </>
                );
        }
    };

    const overlay = prompt ? (
        <Prompt
            id="prompt-dismiss"
            tone="danger"
            eyebrow="Contract termination"
            title={`Dismiss ${prompt.recruit.callsign}?`}
            lines={[["Gear", "Returned to the rack"]]}
            confirm={{
                label: "Dismiss",
                run: () => {
                    squad.dismiss(prompt.recruit.id);
                    setPrompt(null);
                    save();
                },
            }}
            cancel={{ label: "Keep", run: () => setPrompt(null) }}
            glyphs={glyphs}
        >
            {prompt.recruit.name} leaves the squad. A dismissed operative cannot be hired back.
        </Prompt>
    ) : (
        frame.overlay
    );

    return (
        <ScreenFrame
            location={["HQ", "Squad"]}
            onLocation={frame.onLeave}
            siblings={frame.siblings}
            tabs={
                <Tabs
                    tabs={SQUAD_TABS}
                    active={tab}
                    onSelect={(id) => onTab(id as SquadTab)}
                    glyphs={glyphs}
                />
            }
            status={frame.status}
            columns="minmax(240px, 290px) minmax(0, 1fr) minmax(330px, 370px)"
            commands={<FocusCommandBar glyphs={glyphs} />}
            overlay={overlay}
        >
            <Panel className="hqs-roster">
                <List label="Roster">
                    {roster.map((r) => {
                        const current = r.id === recruit.id;
                        return (
                            <ListRow
                                key={r.id}
                                id={`roster-${r.id}`}
                                instant
                                group="list"
                                thumb={
                                    <Portrait src={portraits[r.id]} rank={squad.rank(r.id).rank} />
                                }
                                name={r.callsign}
                                kind={r.role}
                                tag={current && squad.dirty ? "Edited" : undefined}
                                tagTone="warn"
                                selected={current}
                                title={`${r.callsign} · ${r.role}`}
                                hint={
                                    current
                                        ? "On the stage"
                                        : `${gearName(r.equipment.primary) ?? "Unarmed"} · ${gearName(r.equipment.armor) ?? "No armor"}`
                                }
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
                                              run: () => guard(() => squad.select(r.id)),
                                          },
                                ]}
                            />
                        );
                    })}
                </List>
            </Panel>

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
                            <RankMark rank={rank} /> · {recruit.role}
                        </span>
                        <span className="gui-stage-title">{recruit.callsign}</span>
                        <span className="gui-stage-sub">{recruit.name}</span>
                    </>
                }
            >
                <CharacterCanvas
                    recruit={onStage}
                    appearance={
                        lookPreview
                            ? { ...squad.look.appearance, ...lookPreview }
                            : squad.look.appearance
                    }
                    onState={setStage}
                />
            </StagePanel>

            <Panel className="uis-inspector">
                {picker ? (
                    <Picker
                        slot={picker}
                        recruit={recruit}
                        candidate={candidate}
                        images={images}
                        onPick={(item) => {
                            squad.equip(picker, item);
                            setPicker(null);
                            save();
                        }}
                        onClose={() => setPicker(null)}
                    />
                ) : (
                    <div className="hqs-stack" key={tab}>
                        {inspector()}
                    </div>
                )}
            </Panel>
            {/* Portraits are drawn by a short-lived studio of their own, off screen. */}
            <Offstage ref={studioHost} />
        </ScreenFrame>
    );
}

type PickerProps = {
    slot: (typeof LOADOUT_SLOTS)[number];
    recruit: Recruit;
    /** The item under the cursor, previewed on the stage ("" for none). */
    candidate?: string;
    images: Record<string, string>;
    onPick: (item: string | null) => void;
    onClose: () => void;
};

/**
 * The loadout picker: the inspector turns into a list of what fits the slot.
 * The cursor is held in it (its own focus scope); the stage wears whatever
 * the cursor is on; Confirm issues it, Back returns to the loadout.
 */
function Picker({ slot, recruit, candidate, images, onPick, onClose }: PickerProps) {
    const items = SLOT_ITEMS[slot];
    const current = recruit.equipment[slot];
    const before = recruitStats(recruit);
    const after =
        candidate !== undefined
            ? recruitStats({
                  ...recruit,
                  equipment: { ...recruit.equipment, [slot]: candidate || null },
              })
            : before;
    const close: Command = { action: "back", label: "Loadout", run: onClose };
    return (
        <FocusScope id="picker" back={close}>
            <div className="hqs-stack">
                <Eyebrow>{LOADOUT_SLOT_NAMES[slot]}</Eyebrow>
                <List label={LOADOUT_SLOT_NAMES[slot]}>
                    {items.map((item) => {
                        return (
                            <ListRow
                                key={item.id}
                                id={`pick-${item.id}`}
                                group="picker"
                                thumb={<Thumb src={images[item.id]} icon={SLOT_ICON[slot]} />}
                                name={item.name}
                                tag={item.id === current ? "Issued" : undefined}
                                tagTone="accent"
                                selected={item.id === current}
                                title={item.name}
                                hint={item.effect}
                                commands={[
                                    ...(item.id === current
                                        ? []
                                        : ([
                                              {
                                                  action: "confirm",
                                                  label: "Issue",
                                                  tone: "primary",
                                                  run: () => onPick(item.id),
                                              },
                                          ] satisfies Command[])),
                                    close,
                                ]}
                            />
                        );
                    })}
                    {slot === "utility" && (
                        <ListRow
                            id="pick-none"
                            group="picker"
                            thumb={<Thumb icon={SLOT_ICON[slot]} />}
                            name="Nothing"
                            title="Nothing"
                            hint="Leave the slot empty"
                            commands={[
                                ...(current
                                    ? ([
                                          {
                                              action: "confirm",
                                              label: "Clear slot",
                                              tone: "primary",
                                              run: () => onPick(null),
                                          },
                                      ] satisfies Command[])
                                    : []),
                                close,
                            ]}
                        />
                    )}
                </List>
                <StatChanges before={before} after={after} />
            </div>
        </FocusScope>
    );
}

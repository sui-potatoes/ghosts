// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * HQ / Deploy: mission prep as a diorama. Three podiums (a match deploys
 * three per side), each holding an operative as a figurine on a lit plinth
 * with an engraved base plate: callsign, rank, role, the kit as pictograms,
 * a COST and a BASE / CUSTOM marker. The podium under the cursor steps
 * forward into its light; the rest recede. Confirm on a podium picks who
 * stands there: None, or a recruit on no podium yet (the figure previews the
 * recruit under the cursor). Nobody moves between podiums. The budget is SAMPLE data (`squad-build.ts`).
 */

import type { Recruit } from "@ghosts/squad/types";
import { useLayoutEffect, useMemo, useState, type ComponentProps, type ReactNode } from "react";

import { useRecruitPortraits } from "../squad/useRecruitPortraits";
import {
    FocusCommandBar,
    FocusScope,
    Icon,
    List,
    ListRow,
    Prompt,
    ScreenFrame,
    StatusChip,
    Stepper,
    useFocusable,
    useFocusState,
    type Command,
    type GlyphSet,
} from "../../ui";
import { Offstage, Portrait } from "../headquarters/squad/parts";
import { gearName, ITEMS, rankIcon } from "./data";
import type { Anchor } from "../squad-view/podium-scene";
import { Podium, PodiumCanvas } from "../squad-view/podiums";
import { benchOf, place } from "../squad-view/rules";
import { ManagePreset, missingLine, NamePrompt, PresetRail } from "./preset-rail";
import {
    add,
    BUILT_INS,
    copyName,
    fromSquad,
    gaps,
    load as loadPresets,
    MAX_PRESETS,
    modified as presetModified,
    overwrite,
    remove,
    rename,
    resolve,
    store as storePresets,
    type Inventory,
    type Preset,
} from "./presets";
import {
    buildMarker,
    costLines,
    deployRefusal,
    loadoutCost,
    modTier,
    SAMPLE_CAPS,
    squadCost,
    type Loadout,
} from "./squad-build";

/** A recruit's kit as a build. */
export function loadoutOf(recruit: Recruit): Loadout {
    return {
        primary: recruit.equipment.primary,
        mods: { ...(recruit.attachments ?? {}) },
        armor: recruit.equipment.armor,
        utility: recruit.equipment.utility,
    };
}

/** A recruit re-equipped with a build (for the preview; nothing is saved). */
function withLoadout(recruit: Recruit, loadout: Loadout): Recruit {
    return {
        ...recruit,
        equipment: {
            ...recruit.equipment,
            primary: loadout.primary,
            armor: loadout.armor,
            utility: loadout.utility,
        },
        attachments: { ...loadout.mods },
    };
}

/** Mission prep's state, held by the screen root so it survives a section switch. */
export function useDeployState(roster: Recruit[]) {
    const [podiums, setPodiums] = useState<(string | null)[]>(() =>
        [0, 1, 2].map((i) => roster[i]?.id ?? null),
    );
    const [cap, setCap] = useState<string>(SAMPLE_CAPS[0].id);
    // The player's presets, from this device; the built-ins come first on the shelf.
    const [mine, setMineState] = useState<Preset[]>(() => loadPresets(safeStorage()));
    const setMine = (next: Preset[]) => {
        setMineState(next);
        storePresets(safeStorage(), next);
    };
    const [applied, setApplied] = useState<string | null>(null);
    return { podiums, setPodiums, cap, setCap, mine, setMine, applied, setApplied };
}

export type DeployState = ReturnType<typeof useDeployState>;

/** localStorage, or nothing where reading it throws (blocked site data). */
function safeStorage(): Storage | undefined {
    try {
        return window.localStorage;
    } catch {
        return undefined;
    }
}

type Props = {
    deploy: DeployState;
    roster: Recruit[];
    rank: (id: string) => { rank: string };
    glyphs: GlyphSet;
    frame: {
        siblings: ComponentProps<typeof ScreenFrame>["siblings"];
        status: ReactNode;
        onLeave: () => void;
        overlay: ReactNode;
    };
    /** Jump to the operative's loadout in the Squad section. */
    onEditLoadout: (recruitId: string) => void;
    /** What the armory holds, for the presets' gaps. */
    owned: Set<string>;
    /** Re-equip an operative with a preset's build. */
    setLoadout: (recruitId: string, loadout: Loadout) => void;
};

type DeployPrompt =
    | { kind: "deploy" }
    | { kind: "name"; mode: "new" | "rename" | "duplicate"; preset?: Preset }
    | { kind: "delete"; preset: Preset }
    | null;

const ROMAN = ["", "I", "II", "III"];

export function Deploy({
    deploy,
    roster,
    rank,
    glyphs,
    frame,
    onEditLoadout,
    owned,
    setLoadout,
}: Props) {
    const store = useFocusState();
    const { podiums, setPodiums, cap: capId, setCap, mine, setMine, applied, setApplied } = deploy;
    const [managing, setManaging] = useState<Preset | null>(null);
    const [anchors, setAnchors] = useState<Anchor[]>([]);
    const [picking, setPicking] = useState<number | null>(null);
    const [prompt, setPrompt] = useState<DeployPrompt>(null);
    const [deployed, setDeployed] = useState(false);
    const [stage, setStage] = useState<{ loading: boolean; error?: string }>({ loading: true });
    const { portraits, studioHost } = useRecruitPortraits(roster);

    useLayoutEffect(() => {
        store.focusGroup("podiums");
    }, [store]);
    // The podiums follow the scene's layout; the cursor follows them.
    useLayoutEffect(() => store.relayout(), [store, anchors]);

    const byId = (id: string | null) => roster.find((r) => r.id === id) ?? null;
    const cap = SAMPLE_CAPS.find((c) => c.id === capId) ?? SAMPLE_CAPS[0];

    // While picking, the podium wears the recruit under the cursor.
    const focusedId = store.node(store.focused)?.id ?? "";
    const candidate =
        picking !== null && focusedId.startsWith("pick-")
            ? focusedId.slice("pick-".length)
            : undefined;
    const inventory: Inventory = useMemo(
        () => ({ owned, roster: new Set(roster.map((r) => r.id)) }),
        [owned, roster],
    );
    const presets = useMemo(() => [...BUILT_INS, ...mine], [mine]);
    const previewing = focusedId.startsWith("preset-")
        ? presets.find((p) => `preset-${p.id}` === focusedId)
        : undefined;
    const shown = useMemo(() => {
        const ids = [...podiums];
        if (previewing) return resolve(previewing, ids, inventory);
        if (picking === null || candidate === undefined) return ids;
        const id = candidate === "none" ? null : candidate;
        ids[picking] = id;
        return ids;
    }, [podiums, picking, candidate, previewing, inventory]);
    // A focused preset re-equips the figures live; nothing is applied yet.
    const figures = shown.map((id, i) => {
        const r = byId(id);
        const slot = previewing?.podiums[i];
        return r && slot ? withLoadout(r, slot.loadout) : r;
    });
    const loadouts = figures.map((r) => (r ? loadoutOf(r) : null));
    const appliedPreset = presets.find((p) => p.id === applied);
    const changed =
        !!appliedPreset &&
        presetModified(
            appliedPreset,
            podiums.map((id) => {
                const r = byId(id);
                return r ? loadoutOf(r) : null;
            }),
        );
    const previewGaps = previewing ? gaps(previewing, inventory) : null;
    const total = squadCost(loadouts);
    const over = total > cap.cap;
    const refusal = deployRefusal(loadouts, cap.cap);

    const focusIndex =
        picking ?? (focusedId.startsWith("podium-") ? Number(focusedId.slice(-1)) : null);

    const deployCommand: Command = {
        action: "confirm",
        label: "Deploy",
        tone: "primary",
        deny: refusal ?? undefined,
        run: () => setPrompt({ kind: "deploy" }),
    };

    /** Put a preset on the podiums: its recruits where preferred, everyone re-equipped. */
    const apply = (preset: Preset) => {
        const ids = resolve(preset, podiums, inventory);
        ids.forEach((id, i) => {
            const slot = preset.podiums[i];
            if (id && slot) setLoadout(id, slot.loadout);
        });
        setPodiums(ids);
        setApplied(preset.id);
    };
    const current = () =>
        podiums.map((id) => {
            const r = byId(id);
            return r ? { id: r.id, role: r.role, loadout: loadoutOf(r) } : null;
        });

    const presetCommands = (preset: Preset): Command[] => {
        const isApplied = preset.id === applied;
        const missing = missingLine(preset, inventory);
        const confirm: Command =
            isApplied && changed
                ? {
                      action: "confirm",
                      label: "Save changes",
                      short: "Save",
                      tone: "primary",
                      deny: preset.builtIn
                          ? "Built-in presets don't change. Save as new"
                          : undefined,
                      run: () => {
                          const edit = overwrite(
                              mine,
                              preset.id,
                              fromSquad(preset.id, preset.name, current()).podiums,
                          );
                          if (edit.ok) setMine(edit.presets);
                      },
                  }
                : {
                      action: "confirm",
                      label: isApplied ? "Applied" : "Apply",
                      tone: "primary",
                      deny: isApplied ? "Already on the podiums" : (missing ?? undefined),
                      run: () => apply(preset),
                  };
        return [confirm, { action: "reset", label: "Manage", run: () => setManaging(preset) }];
    };

    const podiumCommands = (i: number): Command[] => {
        const recruit = figures[i];
        if (!recruit)
            return [
                { action: "confirm", label: "Assign", tone: "primary", run: () => setPicking(i) },
            ];
        return [
            {
                action: "confirm",
                label: "Change operative",
                short: "Change",
                tone: "primary",
                run: () => setPicking(i),
            },
            {
                action: "reset",
                label: "Edit loadout",
                short: "Loadout",
                run: () => onEditLoadout(recruit.id),
            },
        ];
    };

    const plate = (i: number) => {
        const recruit = figures[i];
        if (!recruit)
            return (
                <div className="sqv-plate-engraved" data-vacant>
                    <span className="sqv-plate-name">None</span>
                    <span className="sqv-plate-line">Podium {i + 1}</span>
                </div>
            );
        const loadout = loadouts[i]!;
        const marker = buildMarker(recruit.role, loadout);
        const mods = Object.values(loadout.mods).filter((m): m is string => !!m);
        const armorTier = loadout.armor ? (ITEMS[loadout.armor]?.tier ?? 1) : 0;
        const r = rank(recruit.id).rank;
        return (
            <div className="sqv-plate-engraved">
                <span className="sqv-plate-head">
                    <span className="sqv-plate-name">{recruit.callsign}</span>
                    <span className="uis-plate-marker" data-marker={marker}>
                        {marker === "base" ? "Base" : "Custom"}
                    </span>
                </span>
                <span className="sqv-plate-line">
                    <Icon name={rankIcon(r)} size={12} />
                    {r} · {recruit.role}
                </span>
                <span className="sqv-plate-kit" aria-label="Loadout">
                    <span title={gearName(loadout.primary)}>
                        <Icon name="primary" size={14} />
                        <span className="sqv-pips">
                            {[0, 1, 2].map((k) => (
                                // An upgrade's tier is how far its pip fills.
                                <i key={k} data-tier={mods[k] ? modTier(mods[k]) : undefined} />
                            ))}
                        </span>
                    </span>
                    <span title={gearName(loadout.armor)}>
                        <Icon name="armor" size={14} />
                        <b>{ROMAN[armorTier]}</b>
                    </span>
                    <span
                        title={gearName(loadout.utility) ?? "No utility"}
                        data-empty={!loadout.utility || undefined}
                    >
                        <Icon name="utility" size={14} />
                    </span>
                </span>
                {previewGaps?.[i]?.items.length ? (
                    <span className="uis-plate-gap">
                        Missing {previewGaps[i].items.map((id) => gearName(id) ?? id).join(", ")}
                    </span>
                ) : null}
                <span className="uis-plate-cost" data-over={over || undefined}>
                    Cost <b>{loadoutCost(loadout)}</b>
                </span>
            </div>
        );
    };

    const status = (
        <>
            {frame.status}
            <StatusChip label="Cap" value={`${cap.label} · ${cap.cap}`} />
            <StatusChip
                label="Budget"
                value={`${total} / ${cap.cap}`}
                tone={over ? "warn" : "default"}
            />
            {appliedPreset && (
                <StatusChip
                    label="Preset"
                    value={changed ? `${appliedPreset.name} · Modified` : appliedPreset.name}
                    tone={changed ? "warn" : "default"}
                />
            )}
            {deployed && <StatusChip label="Squad" value="Deployed" state="live" />}
        </>
    );

    const named = (
        mode: "new" | "rename" | "duplicate",
        preset: Preset | undefined,
        name: string,
    ) => {
        const id = `p${Date.now().toString(36)}`;
        const edit =
            mode === "rename" && preset
                ? rename(mine, preset.id, name)
                : add(
                      mine,
                      mode === "duplicate" && preset
                          ? { ...preset, id, name, builtIn: false }
                          : fromSquad(id, name, current()),
                  );
        if (edit.ok) {
            setMine(edit.presets);
            if (mode === "new") setApplied(id);
        }
        setPrompt(null);
    };

    const overlay =
        prompt?.kind === "deploy" ? (
            <Prompt
                id="prompt-deploy"
                eyebrow="Mission prep"
                title="Deploy the squad?"
                lines={[
                    ["Squad", figures.map((f) => f?.callsign).join(" · ")],
                    ["Budget", `${total} / ${cap.cap}`],
                ]}
                confirm={{
                    label: "Deploy",
                    run: () => {
                        setPrompt(null);
                        setDeployed(true);
                    },
                }}
                cancel={{ label: "Not yet", run: () => setPrompt(null) }}
                glyphs={glyphs}
            >
                The three operatives take these loadouts into the match.
            </Prompt>
        ) : prompt?.kind === "name" ? (
            <NamePrompt
                title={
                    prompt.mode === "rename"
                        ? `Rename ${prompt.preset?.name}?`
                        : prompt.mode === "duplicate"
                          ? `Duplicate ${prompt.preset?.name}?`
                          : "Save this squad as a preset?"
                }
                initial={
                    prompt.mode === "rename"
                        ? (prompt.preset?.name ?? "")
                        : copyName(presets, prompt.preset?.name ?? "Squad")
                }
                confirm={prompt.mode === "rename" ? "Rename" : "Save"}
                glyphs={glyphs}
                onDone={(name) => named(prompt.mode, prompt.preset, name)}
                onCancel={() => setPrompt(null)}
            />
        ) : prompt?.kind === "delete" ? (
            <Prompt
                id="prompt-preset-delete"
                tone="danger"
                eyebrow="Squad preset"
                title={`Delete ${prompt.preset.name}?`}
                confirm={{
                    label: "Delete",
                    run: () => {
                        const edit = remove(mine, prompt.preset.id);
                        if (edit.ok) setMine(edit.presets);
                        if (applied === prompt.preset.id) setApplied(null);
                        setPrompt(null);
                    },
                }}
                cancel={{ label: "Keep", run: () => setPrompt(null) }}
                glyphs={glyphs}
            >
                The squad on the podiums stays as it is.
            </Prompt>
        ) : (
            frame.overlay
        );

    return (
        <ScreenFrame
            location={["HQ", "Deploy"]}
            onLocation={frame.onLeave}
            siblings={frame.siblings}
            status={status}
            columns="minmax(0, 1fr)"
            commands={<FocusCommandBar glyphs={glyphs} />}
            overlay={overlay}
        >
            <section className="sqv-diorama" data-picking={picking !== null || undefined}>
                <PodiumCanvas
                    figures={figures}
                    focus={focusIndex}
                    lit={[true, true, true]}
                    onAnchors={setAnchors}
                    onState={setStage}
                />
                <CapChooser value={capId} onChange={setCap} />
                <PresetRail
                    presets={presets}
                    cap={cap.cap}
                    applied={applied}
                    modified={changed}
                    inventory={inventory}
                    full={mine.length >= MAX_PRESETS}
                    commandsFor={presetCommands}
                    onSaveNew={() => setPrompt({ kind: "name", mode: "new" })}
                />
                {managing && (
                    <ManagePreset
                        preset={managing}
                        applied={managing.id === applied}
                        modified={changed}
                        full={mine.length >= MAX_PRESETS}
                        onClose={() => setManaging(null)}
                        onRevert={() => {
                            setManaging(null);
                            apply(managing);
                        }}
                        onOverwrite={() => {
                            const edit = overwrite(
                                mine,
                                managing.id,
                                fromSquad(managing.id, managing.name, current()).podiums,
                            );
                            if (edit.ok) setMine(edit.presets);
                            setApplied(managing.id);
                            setManaging(null);
                        }}
                        onRename={() => {
                            setManaging(null);
                            setPrompt({ kind: "name", mode: "rename", preset: managing });
                        }}
                        onDuplicate={() => {
                            setManaging(null);
                            setPrompt({ kind: "name", mode: "duplicate", preset: managing });
                        }}
                        onDelete={() => {
                            setManaging(null);
                            setPrompt({ kind: "delete", preset: managing });
                        }}
                    />
                )}
                {[0, 1, 2].map((i) => {
                    const recruit = figures[i];
                    const lines = loadouts[i] ? costLines(loadouts[i]!) : [];
                    return (
                        <Podium
                            key={i}
                            index={i}
                            anchor={anchors[i]}
                            dim={picking !== null && picking !== i}
                            title={
                                recruit
                                    ? `${recruit.callsign} · ${rank(recruit.id).rank} · ${recruit.role}`
                                    : `Podium ${i + 1}`
                            }
                            hint={
                                recruit
                                    ? `${lines.map((l) => `${l.label} ${l.cost}`).join(" · ")} = ${loadoutCost(loadouts[i]!)}`
                                    : "Assign an operative"
                            }
                            commands={podiumCommands(i)}
                        >
                            {plate(i)}
                        </Podium>
                    );
                })}
                <DeployPlaque command={deployCommand} over={over} />
                {stage.loading && <div className="gui-stage-status">Bringing the squad in</div>}
                {picking !== null && (
                    <RecruitPicker
                        index={picking}
                        roster={roster}
                        podiums={podiums}
                        portraits={portraits}
                        rank={rank}
                        onPick={(id) => {
                            setPodiums((list) => place(list, picking, id));
                            setPicking(null);
                        }}
                        onClose={() => setPicking(null)}
                    />
                )}
            </section>
            <Offstage ref={studioHost} />
        </ScreenFrame>
    );
}

/** Puts the cursor on `id` once, when a scope opens (on the current choice). */
function StartOn({ id }: { id: string }) {
    const store = useFocusState();
    useLayoutEffect(() => {
        store.focus(id, false);
        // Once, on open.
    }, []);
    return null;
}

/** The sample cap, as a small chooser in the diorama's corner. */
function CapChooser({ value, onChange }: { value: string; onChange: (id: string) => void }) {
    return (
        <div className="uis-cap">
            <Stepper
                id="deploy-cap"
                group="cap"
                label="Cap"
                options={SAMPLE_CAPS.map((c) => [c.id, `${c.label} · ${c.cap}`])}
                value={value}
                onChange={onChange}
                title="Budget cap (sample)"
                hint="Sample caps: the game has no costs or budget yet"
                commands={[{ action: "nav", label: "Change", glyph: "lr" }]}
            />
        </div>
    );
}

/** Deploy: the screen's primary, a stencilled plaque at the diorama's edge. */
function DeployPlaque({ command, over }: { command: Command; over: boolean }) {
    const { props } = useFocusable<HTMLButtonElement>({
        id: "deploy",
        group: "deploy",
        title: "Deploy",
        hint: command.deny ?? "Take this squad into the match",
        commands: [command],
    });
    return (
        <button
            type="button"
            tabIndex={-1}
            className="sqv-plaque"
            data-refused={command.deny ? "" : undefined}
            data-over={over || undefined}
            {...props}
        >
            Deploy
        </button>
    );
}

type PickerProps = {
    index: number;
    roster: Recruit[];
    podiums: (string | null)[];
    portraits: Record<string, string>;
    rank: (id: string) => { rank: string };
    onPick: (id: string | null) => void;
    onClose: () => void;
};

/** Who stands on a podium: the roster, its own scope; the podium previews the row under the cursor. */
function RecruitPicker({ index, roster, podiums, portraits, rank, onPick, onClose }: PickerProps) {
    const close: Command = { action: "back", label: "Cancel", run: onClose };
    const current = podiums[index];
    // Only recruits on no podium are on offer, then None.
    const free = new Set(
        benchOf(
            roster.map((r) => r.id),
            podiums,
        ),
    );
    const unused = roster.filter((r) => free.has(r.id));
    return (
        <FocusScope id="deploy-picker" back={close}>
            <StartOn id={unused.length ? `pick-${unused[0].id}` : "pick-none"} />
            <div className="sqv-picker gui-panel">
                <header className="gui-panel-head">
                    <span className="gui-panel-label">Podium {index + 1}</span>
                </header>
                <div className="gui-panel-body">
                    <List label={`Podium ${index + 1}`}>
                        {unused.map((r) => {
                            const cost = loadoutCost(loadoutOf(r));
                            return (
                                <ListRow
                                    key={r.id}
                                    id={`pick-${r.id}`}
                                    group="deploy-picker"
                                    thumb={<Portrait src={portraits[r.id]} />}
                                    name={r.callsign}
                                    kind={`${rank(r.id).rank} · ${r.role}`}
                                    tag={String(cost)}
                                    title={r.callsign}
                                    hint={`Cost ${cost}`}
                                    commands={[
                                        {
                                            action: "confirm",
                                            label: "Place",
                                            tone: "primary",
                                            run: () => onPick(r.id),
                                        },
                                        close,
                                    ]}
                                />
                            );
                        })}
                        <ListRow
                            id="pick-none"
                            group="deploy-picker"
                            name="None"
                            title="None"
                            hint={
                                current
                                    ? "Removes the operative from the squad"
                                    : "The podium stays empty"
                            }
                            commands={[
                                {
                                    action: "confirm",
                                    label: current ? "Clear" : "Keep empty",
                                    tone: "primary",
                                    run: () => onPick(null),
                                },
                                close,
                            ]}
                        />
                    </List>
                </div>
            </div>
        </FocusScope>
    );
}

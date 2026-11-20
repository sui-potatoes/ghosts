// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * HQ / Armory in the sample's language, composed like Squad: the requisition
 * list on the left, the focused item on the 3D stage in the centre (the
 * Armory's own gun builds, armor worn by the first operative, a mod fitted on
 * the Standard Rifle), and its specification on the right. Only the game's
 * items (`data.ts`); requisition is free, as it is on testnet, and any
 * operative takes any item; the one refusal is the game's own rule: one
 * upgrade of each kind, three at most, per rifle.
 */

import { ATTACHMENT_SLOT_NAMES, attachmentById } from "@ghosts/squad/catalog";
import type { AttachmentSlot, Recruit } from "@ghosts/squad/types";
import { useLayoutEffect, useMemo, useState, type ComponentProps, type ReactNode } from "react";

import { useEquipmentImages } from "../headquarters/equipmentImages";
import {
    Eyebrow,
    FocusCommandBar,
    List,
    ListRow,
    Panel,
    Prompt,
    ReadoutLine,
    ScreenFrame,
    SlotRow,
    StagePanel,
    STAT_ICON,
    StatRow,
    Tabs,
    Thumb,
    useFocusState,
    type Command,
    type GlyphSet,
    type IconName,
} from "../../ui";
import { CharacterCanvas } from "../headquarters/squad/CharacterCanvas";
import { GearCanvas } from "../headquarters/armory/GearCanvas";
import {
    FITTED,
    ISSUED,
    ITEMS,
    MAX_FITTINGS,
    OWNED,
    SECTIONS,
    STOCK,
    type Item,
    type Section,
} from "./data";

/** The pictogram a row falls back to when the game has no thumbnail for it. */
const TAB_ICON: Record<Section, IconName> = {
    weapons: "primary",
    armor: "armor",
    utility: "utility",
    mods: "primary",
};

type Fitted = Record<string, Partial<Record<AttachmentSlot, string>>>;

/** The armory's local state, held by the screen root so it survives a section switch. */
export function useArmoryState() {
    const [owned, setOwned] = useState(() => new Set(OWNED));
    const [issued, setIssued] = useState(ISSUED);
    const [fitted, setFitted] = useState<Fitted>(FITTED);
    return { owned, setOwned, issued, setIssued, fitted, setFitted };
}

export type ArmoryState = ReturnType<typeof useArmoryState>;

type Props = {
    armory: ArmoryState;
    tab: Section;
    onTab: (tab: Section) => void;
    /** Who the armory issues to and dresses on the stage: the squad's first operative. */
    wearer?: Recruit;
    glyphs: GlyphSet;
    frame: {
        siblings: ComponentProps<typeof ScreenFrame>["siblings"];
        status: ReactNode;
        onLeave: () => void;
        overlay: ReactNode;
    };
    save: () => void;
};

/** Which rifle a mod is fitted to, if any. */
function fittedOn(fitted: Fitted, mod: string): string | undefined {
    return Object.entries(fitted).find(([, slots]) => Object.values(slots).includes(mod))?.[0];
}

export function Armory({ armory, tab, onTab, wearer, glyphs, frame, save }: Props) {
    const store = useFocusState();
    const [stage, setStage] = useState<{ loading: boolean; error?: string }>({ loading: false });
    const [prompt, setPrompt] = useState<Item | null>(null);
    const { owned, setOwned, issued, setIssued, fitted, setFitted } = armory;
    const images = useEquipmentImages();

    // A new tab puts the cursor on its first row (after the rows registered).
    useLayoutEffect(() => {
        store.focusGroup("list");
    }, [store, tab]);

    const items = STOCK[tab];
    const listId = store.remembered("list");
    const preview = items.find((i) => `row-${i.id}` === listId) ?? items[0];
    const issuedItem = items.find((i) => i.id === issued[tab]);
    const who = wearer?.callsign ?? "VEX";
    const whoName = who.charAt(0) + who.slice(1).toLowerCase();

    const toList: Command = {
        action: "back",
        label: "Requisition list",
        run: () => store.focusGroup("list", true, true),
    };

    const rowCommands = (item: Item): Command[] => {
        if (item.id === issued[tab]) {
            return [
                {
                    action: "confirm",
                    label: "Inspect",
                    tone: "primary",
                    run: () => store.focusGroup("detail", true, true),
                },
            ];
        }
        if (owned.has(item.id)) {
            if (item.section === "mods")
                return [
                    {
                        action: "confirm",
                        label: "Fit on the rifle",
                        short: "Fit",
                        tone: "primary",
                        run: () => store.focusGroup("detail", true, true),
                    },
                ];
            return [
                {
                    action: "confirm",
                    label: `Issue to ${whoName}`,
                    short: "Issue",
                    tone: "primary",
                    run: () => {
                        setIssued((s) => ({ ...s, [tab]: item.id }));
                        save();
                    },
                },
            ];
        }
        return [
            {
                action: "confirm",
                label: "Requisition",
                short: "Order",
                tone: "primary",
                run: () => setPrompt(item),
            },
        ];
    };

    const rowTag = (item: Item): [string, "default" | "accent" | "warn" | "dim"] => {
        if (item.id === issued[tab]) return ["Issued", "accent"];
        if (item.section === "mods") {
            const on = fittedOn(fitted, item.id);
            if (on) return ["Fitted", "accent"];
            return owned.has(item.id) ? ["In rack", "default"] : ["", "default"];
        }
        if (owned.has(item.id)) return ["In rack", "default"];
        return ["", "default"];
    };

    const rowHint = (item: Item): string => {
        if (item.id === issued[tab]) return `${whoName} carries it into the next match`;
        if (item.section === "mods") {
            const on = fittedOn(fitted, item.id);
            return on ? `Fitted to the ${ITEMS[on]?.name}` : item.effect;
        }
        if (owned.has(item.id)) return "In the rack. Issuing it returns the current one";
        return item.effect;
    };

    const fits = preview ? (fitted[preview.id] ?? {}) : {};

    // Armor is shown worn: the first operative, dressed in the focused set.
    const dressed = useMemo(
        () =>
            wearer && preview?.wear
                ? { ...wearer, equipment: { ...wearer.equipment, armor: preview.wear } }
                : undefined,
        [wearer, preview?.wear],
    );

    const stageBody = () => {
        if (!preview)
            return (
                <div className="gui-void">
                    <span className="gui-void-mark" aria-hidden />
                    <span>No line selected</span>
                </div>
            );
        if (dressed)
            return (
                <CharacterCanvas
                    recruit={dressed}
                    appearance={dressed.appearance}
                    onState={setStage}
                />
            );
        // A mod is shown fitted on the Standard Rifle, alone.
        const attachments = preview.mod ? { [preview.mod]: preview.id } : fits;
        return <GearCanvas model={preview.model} attachments={attachments} onState={setStage} />;
    };

    const tag = preview ? rowTag(preview)[0] : "";
    const overlay = prompt ? (
        <Prompt
            id="prompt-requisition"
            eyebrow="Requisition"
            title={`Requisition ${prompt.name}?`}
            lines={[["Effect", prompt.effect]]}
            confirm={{
                label: "Requisition",
                run: () => {
                    setOwned((s) => new Set(s).add(prompt.id));
                    setPrompt(null);
                    save();
                },
            }}
            cancel={{ label: "Cancel", run: () => setPrompt(null) }}
            glyphs={glyphs}
        >
            Added to the armory rack, ready to issue or fit
        </Prompt>
    ) : (
        frame.overlay
    );

    // One canvas kind per tab, so switching from guns to armor swaps renderers.
    const stageKey = dressed ? "character" : preview ? "gear" : "none";

    return (
        <ScreenFrame
            location={["HQ", "Armory"]}
            onLocation={frame.onLeave}
            siblings={frame.siblings}
            tabs={
                <Tabs
                    tabs={SECTIONS.map((s) => ({ ...s, count: STOCK[s.id].length }))}
                    active={tab}
                    onSelect={(id) => onTab(id as Section)}
                    glyphs={glyphs}
                />
            }
            status={frame.status}
            columns="minmax(260px, 310px) minmax(0, 1fr) minmax(330px, 370px)"
            commands={<FocusCommandBar glyphs={glyphs} />}
            overlay={overlay}
        >
            <Panel className="uis-list-panel">
                <List label="Requisition list">
                    {items.map((item) => {
                        const [tag, tone] = rowTag(item);
                        return (
                            <ListRow
                                key={item.id}
                                id={`row-${item.id}`}
                                group="list"
                                thumb={
                                    <Thumb
                                        src={images[item.wear ?? item.id]}
                                        icon={TAB_ICON[tab]}
                                    />
                                }
                                name={item.name}
                                tag={tag || undefined}
                                tagTone={tone}
                                selected={item.id === issued[tab]}
                                title={item.name}
                                hint={rowHint(item)}
                                commands={rowCommands(item)}
                            />
                        );
                    })}
                </List>
            </Panel>

            <StagePanel
                key={stageKey}
                id="stage"
                group="stage"
                label="Stage"
                loading={!!preview && stage.loading}
                error={stage.error}
                back={toList}
                caption={
                    preview && (
                        <>
                            <span className="gui-stage-eyebrow">
                                {preview.kind}
                                {dressed ? ` · worn by ${who}` : ""}
                            </span>
                            <span className="gui-stage-title" key={preview.id}>
                                {preview.name}
                            </span>
                            {tag && (
                                <span
                                    className="gui-stage-tag"
                                    data-state={
                                        tag === "Issued" || tag === "Fitted" ? "issued" : undefined
                                    }
                                >
                                    {tag}
                                </span>
                            )}
                        </>
                    )
                }
            >
                {stageBody()}
            </StagePanel>

            <Panel className="uis-detail-panel">
                {preview ? (
                    <Spec
                        item={preview}
                        issued={issuedItem}
                        owned={owned}
                        isIssued={preview.id === issued[tab]}
                        fitted={fits}
                        allFitted={fitted}
                        images={images}
                        toList={toList}
                        onFit={(slot, id) => {
                            setFitted((f) => ({
                                ...f,
                                [preview.id]: { ...f[preview.id], [slot]: id },
                            }));
                            save();
                        }}
                        onClear={(slot) => {
                            setFitted((f) => {
                                const next = { ...f[preview.id] };
                                delete next[slot];
                                return { ...f, [preview.id]: next };
                            });
                            save();
                        }}
                    />
                ) : (
                    <div className="gui-void">
                        <span className="gui-void-mark" aria-hidden />
                        <span>Nothing to specify</span>
                    </div>
                )}
            </Panel>
        </ScreenFrame>
    );
}

type SpecProps = {
    item: Item;
    issued?: Item;
    owned: Set<string>;
    isIssued: boolean;
    fitted: Partial<Record<AttachmentSlot, string>>;
    allFitted: Fitted;
    images: Record<string, string>;
    toList: Command;
    onFit: (slot: AttachmentSlot, id: string) => void;
    onClear: (slot: AttachmentSlot) => void;
};

function Spec({
    item,
    issued,
    owned,
    isIssued,
    fitted,
    allFitted,
    images,
    toList,
    onFit,
    onClear,
}: SpecProps) {
    const compare = issued && !isIssued ? issued : undefined;
    const slots = item.slots ?? [];
    const count = Object.keys(fitted).length;
    // Weapons and armor list their stats; the grenade and the mods say what they do.
    if (!item.stats.length)
        return (
            <>
                <ReadoutLine label="Effect">{item.effect}</ReadoutLine>
                {item.section === "utility" && <ReadoutLine label="Uses">1 per match</ReadoutLine>}
                {item.mod && (
                    <ReadoutLine label="Fits">{ATTACHMENT_SLOT_NAMES[item.mod]} slot</ReadoutLine>
                )}
            </>
        );
    return (
        <>
            {compare && <Eyebrow>Against {compare.name}</Eyebrow>}
            {item.stats.map((stat) => {
                const base = compare?.stats.find((s) => s.key === stat.key);
                return (
                    <StatRow
                        key={stat.key}
                        id={`stat-${stat.key}`}
                        group="detail"
                        label={stat.label}
                        icon={STAT_ICON[stat.key]}
                        value={stat.value}
                        text={stat.text}
                        base={base?.value}
                        max={stat.max}
                        title={stat.label}
                        hint={compare ? `${compare.name}: ${base?.text ?? "—"}` : item.effect}
                        commands={[toList]}
                    />
                );
            })}
            {slots.length > 0 && <Eyebrow meta={`${count} / ${MAX_FITTINGS}`}>Fittings</Eyebrow>}
            {slots.map((slot) => {
                const fit = attachmentById(fitted[slot]);
                const nextId = `${slot}-${fit ? fit.tier + 1 : 1}`;
                const next = fit && fit.tier >= 3 ? undefined : attachmentById(nextId);
                // A fitting is an upgrade object from the rack, not on another rifle.
                const spare =
                    next && owned.has(next.id) && !fittedOn(allFitted, next.id) ? next : undefined;
                const deny = !owned.has(item.id)
                    ? "Requisition the rifle before fitting it"
                    : !next
                      ? "Already the superior fitting"
                      : !fit && count >= MAX_FITTINGS
                        ? `${MAX_FITTINGS} fittings at most. Remove one first`
                        : !spare
                          ? `No spare ${next.name} in the rack`
                          : undefined;
                const commands: Command[] = [
                    ...(fit && owned.has(item.id)
                        ? ([
                              { action: "reset", label: "Remove", run: () => onClear(slot) },
                          ] satisfies Command[])
                        : []),
                    {
                        action: "confirm",
                        label: next ? `Fit ${next.name}` : "Top tier",
                        short: fit ? "Upgrade" : "Fit",
                        tone: "primary",
                        deny,
                        run: () => next && onFit(slot, next.id),
                    },
                    toList,
                ];
                return (
                    <SlotRow
                        key={slot}
                        id={`slot-${slot}`}
                        group="detail"
                        slot={ATTACHMENT_SLOT_NAMES[slot]}
                        image={fit ? images[fit.id] : undefined}
                        item={fit?.name}
                        title={`${ATTACHMENT_SLOT_NAMES[slot]} slot`}
                        hint={fit ? fit.stat : "One upgrade of each kind"}
                        commands={commands}
                    />
                );
            })}
        </>
    );
}

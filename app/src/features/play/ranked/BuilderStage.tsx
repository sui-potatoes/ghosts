// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The squad on stage: one figurine per place on the podium diorama
 * (`squad-view`), each with an engraved plate (unit number, type, price), the
 * cursor moving between the stands. A unit that changes type goes dark and
 * its lamp strikes back on once the new figure stands; pressing Find match
 * strikes every lamp in turn. Reduced motion changes lights at once.
 *
 * `StandList` is the same squad as rows, for phones and for when the scene
 * cannot run.
 */

import type { Recruit } from "@ghosts/squad/types";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { uiLampOn } from "../../../audio";
import { List, ListRow, Thumb, SLOT_ICON, useFocusState, type Command } from "../../../ui";
import type { Issue } from "../economy";
import type { Anchor } from "../../squad-view/podium-scene";
import { Podium, PodiumCanvas } from "../../squad-view/podiums";
import { unitNumber } from "./figures";
import { cr, gearText, typeName, type Stand } from "./model";
import type { SavedType } from "./presets";
import { priceOf } from "../economy";

export const podiumId = (i: number) => `podium-${i}`;
export const listStandId = (i: number) => `sb-stand-${i}`;

/** How long a unit's lamp stays dark before it strikes back on (ms). */
const DARK_MS = 260;
/** Between the lamps striking on when the search starts (ms). */
const SEARCH_BEAT = 150;

export type StandInfo = {
    title: (i: number) => string;
    hint: (i: number) => string;
    commands: (i: number) => Command[];
    issue: (i: number) => Issue | undefined;
};

type StageProps = {
    stands: Stand[];
    figures: (Recruit | null)[];
    rating: number;
    mine: SavedType[];
    info: StandInfo;
    editing: number | null;
    /** Bumped with the place's index when a unit changes type: its lamp strikes. */
    struck: { index: number; n: number } | null;
    searching: boolean;
    still: boolean;
    onFail: () => void;
    children?: ReactNode;
};

export function BuilderStage({
    stands,
    figures,
    rating,
    mine,
    info,
    editing,
    struck,
    searching,
    still,
    onFail,
    children,
}: StageProps) {
    const store = useFocusState();
    const count = stands.length;
    const [anchors, setAnchors] = useState<Anchor[]>([]);
    const [stage, setStage] = useState<{ loading: boolean; error?: string; ready: boolean }>({
        loading: true,
        ready: false,
    });
    const [dark, setDark] = useState<boolean[]>(() => stands.map(() => false));
    const [instant, setInstant] = useState(true);
    const loading = useRef(true);
    loading.current = stage.loading;

    useLayoutEffect(() => store.relayout(), [store, anchors]);

    useEffect(() => {
        if (stage.error) onFail();
        // Once the scene says it failed.
    }, [stage.error]);

    // A unit that changed type: dark, then its lamp strikes once the figure stands.
    useEffect(() => {
        if (!struck || still) return;
        const i = struck.index;
        setInstant(true);
        setDark((d) => d.map((v, k) => (k === i ? true : v)));
        let timer = 0;
        const relight = () => {
            if (loading.current) {
                timer = window.setTimeout(relight, 60);
                return;
            }
            setInstant(false);
            setDark((d) => d.map((v, k) => (k === i ? false : v)));
            uiLampOn(i, true);
        };
        timer = window.setTimeout(relight, DARK_MS);
        return () => {
            window.clearTimeout(timer);
            setDark((d) => d.map((v, k) => (k === i ? false : v)));
        };
    }, [struck?.n, still]);

    // Find match: every lamp out, then struck on one by one.
    useEffect(() => {
        if (!searching || still) return;
        setInstant(true);
        setDark(stands.map(() => true));
        const timers = stands.map((_, i) =>
            window.setTimeout(
                () => {
                    setInstant(false);
                    setDark((d) => d.map((v, k) => (k === i ? false : v)));
                    if (stands[i]) uiLampOn(i, i === stands.length - 1);
                },
                DARK_MS + i * SEARCH_BEAT,
            ),
        );
        return () => {
            timers.forEach((t) => window.clearTimeout(t));
            setDark(stands.map(() => false));
        };
        // On the search starting.
    }, [searching]);

    const focusedId = store.node(store.focused)?.id ?? "";
    const at = focusedId.startsWith("podium-") ? Number(focusedId.slice(7)) : null;
    const focus = searching ? null : (editing ?? at);
    const lit = stands.map((s, i) => !!s && !dark[i]);

    return (
        <section
            className="sqv-diorama grk-stage"
            data-searching={searching || undefined}
            data-editing={editing !== null || undefined}
        >
            <PodiumCanvas
                key={count}
                figures={figures}
                projector
                focus={focus}
                lit={lit}
                instant={instant || still}
                still={still}
                onAnchors={setAnchors}
                onState={(s) => setStage((was) => ({ ...s, ready: was.ready || !s.loading }))}
            />
            {stands.map((unit, i) => {
                const issue = info.issue(i);
                return (
                    <Podium
                        key={i}
                        index={i}
                        anchor={anchors[i]}
                        dim={editing !== null && editing !== i}
                        title={info.title(i)}
                        hint={info.hint(i)}
                        commands={info.commands(i)}
                    >
                        <div
                            className="sqv-plate-engraved"
                            data-vacant={!unit || undefined}
                            data-warn={issue ? "" : undefined}
                        >
                            <span className="sqv-plate-name">Unit {unitNumber(i)}</span>
                            <span className="grk-plate-type">
                                {unit ? typeName(unit, rating, mine) : "No type"}
                            </span>
                            <span className="grk-plate-price">
                                {unit ? cr(priceOf(unit)) : "Choose a type"}
                            </span>
                            {issue && (
                                <span className="sqv-plate-warn">
                                    <i className="gui-warn-mark" aria-hidden />
                                    {issue.kind === "locked" ? "Locked gear" : "Check unit"}
                                </span>
                            )}
                        </div>
                    </Podium>
                );
            })}
            {!stage.ready && !stage.error && (
                <div className="gui-stage-status">Loading the squad</div>
            )}
            {children}
        </section>
    );
}

type ListProps = {
    stands: Stand[];
    rating: number;
    mine: SavedType[];
    info: StandInfo;
    editing: number | null;
    children?: ReactNode;
};

/** The squad as rows: phones, and screens where the scene cannot run. */
export function StandList({ stands, rating, mine, info, editing, children }: ListProps) {
    return (
        <section className="grk-stands" data-editing={editing !== null || undefined}>
            <List label="Squad">
                {stands.map((unit, i) => {
                    const issue = info.issue(i);
                    return (
                        <ListRow
                            key={i}
                            id={listStandId(i)}
                            group="sb-stands"
                            instant
                            thumb={<Thumb icon={SLOT_ICON.armor} />}
                            name={`${unitNumber(i)} · ${unit ? typeName(unit, rating, mine) : "No type"}`}
                            kind={issue?.message ?? (unit ? gearText(unit) : "Choose a type")}
                            tag={unit ? cr(priceOf(unit)) : "Empty"}
                            tagTone={issue ? "warn" : unit ? "default" : "dim"}
                            selected={editing === i}
                            title={info.title(i)}
                            hint={info.hint(i)}
                            commands={info.commands(i)}
                        />
                    );
                })}
            </List>
            {children}
        </section>
    );
}

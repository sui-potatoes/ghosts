// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Ranked: pick 3x3 or 4x4, build the squad within the budget of the player's
 * tier (`SquadBuilder`), find an opponent. The tier, the budget, the prices and
 * the unlocks are the contract's (`Rules`, read live, and the player's
 * `Account`); the search is the real queue. This draws; `index.tsx` feeds it
 * from the chain and `qa.tsx` from fixtures.
 */

import { useEffect, useLayoutEffect, useState } from "react";

import {
    ActionRow,
    FocusCommandBar,
    FocusRoot,
    FocusScope,
    ListRow,
    ScreenFrame,
    StatusChip,
    useFocusable,
    useFocusState,
    useGlyphSet,
    type Command,
} from "../../../ui";
import { sizeOpen, squadSize, type Issue, type Loadout, type Mode } from "../economy";
import type { Standing } from "../rating";
import {
    cr,
    emptySaved,
    issueText,
    parseSaved,
    serializeSaved,
    SIZES,
    squadCost,
    STORE_KEY,
    tierNotice,
    type Saved,
} from "./model";
import { clock, findAction, searchCard, type RankedSearchState, type SearchCard } from "./search";
import { SquadBuilder } from "./SquadBuilder";
import "./ranked.css";

/** The screen's own memory: the size last played and the tier last seen. */
const SCREEN_KEY = `${STORE_KEY}:screen`;

function load(): Saved {
    try {
        const own = localStorage.getItem(SCREEN_KEY);
        // Before the screen kept its own key, the size lived with the squads.
        return parseSaved(own ?? localStorage.getItem(STORE_KEY));
    } catch {
        return emptySaved();
    }
}

function save(saved: Saved) {
    try {
        localStorage.setItem(SCREEN_KEY, serializeSaved({ ...saved, squads: {} }));
    } catch {
        // Storage may be unavailable; the choice lasts for the visit.
    }
}

/** The squad as the builder reports it. */
export type BuiltSquad = { units: Loadout[]; issues: Issue[]; labels: string[] };

/** The state the screen draws, less what it works out itself (the size, the squad, the clock). */
export type RankedViewState = Omit<
    RankedSearchState,
    "mode" | "open" | "tier" | "units" | "spent" | "now"
>;

export type RankedOps = {
    find: (mode: Mode, squad: BuiltSquad) => void;
    cancel: () => void;
    /** Close a refusal or a search that ran out. */
    close: () => void;
    signIn: () => void;
    resume: () => void;
    leave: () => void;
};

/** Ticks once a second while `on`. */
function useNow(on: boolean): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!on) return;
        setNow(Date.now());
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [on]);
    return now;
}

export function RankedView({
    standing,
    state,
    ops,
    searchMode,
}: {
    standing: Standing;
    state: RankedViewState;
    ops: RankedOps;
    /** The size of a ranked search in progress: the builder shows it. */
    searchMode?: Mode | null;
}) {
    const glyphs = useGlyphSet();
    const tier = standing.tier;
    const rating = standing.standing;

    const [screen, setScreen] = useState<Saved>(load);
    // A size with no level is not offered: the builder opens on one that has.
    const chosen = searchMode ?? screen.mode;
    const mode: Mode = sizeOpen(chosen) || searchMode ? chosen : "3x3";
    const budget = standing.budgets[mode];
    const [squad, setSquad] = useState<BuiltSquad | null>(null);
    const seen = { tier: tier.id, name: tier.name, budget };
    // Said once, on arrival, when the tier changed since the last visit.
    const [notice, setNotice] = useState<string | null | undefined>(undefined);
    useEffect(() => {
        if (notice !== undefined || !squad || !state.signedIn || state.loading) return;
        setNotice(tierNotice(screen, rating, mode, squad.units));
        save({ ...screen, seen });
    }, [squad, state.loading]);
    useEffect(() => {
        if (state.signedIn && !state.loading) save({ ...screen, seen });
    }, [mode]);

    const pickMode = (to: Mode) => {
        if (to !== mode) setScreen((s) => ({ ...s, mode: to }));
    };

    const issues = squad?.issues ?? [];
    const gate = !squad ? "Building the squad" : issues.length === 0 ? null : issueText(issues[0]);
    const spent = squad ? squadCost(squad.units) : 0;
    const now = useNow(state.phase === "searching");
    const full: RankedSearchState = {
        ...state,
        mode,
        open: sizeOpen(mode),
        tier: tier.name,
        units: squad?.units.length ?? squadSize(mode),
        spent,
        now,
    };
    const action = findAction(full, gate);
    const card = searchCard(full);

    const back: Command = { action: "back", label: "Back", run: ops.leave };

    const sizes = (
        <div className="grk-sizes">
            {SIZES.map((size) => {
                const open = sizeOpen(size);
                return (
                    <ListRow
                        key={size}
                        id={`size-${size}`}
                        group="side"
                        instant={open}
                        name={`Ranked ${size}`}
                        kind={`${squadSize(size)} units a side`}
                        tag={open ? `${cr(standing.budgets[size])} budget` : "No level"}
                        tagTone={!open ? "dim" : size === mode ? "accent" : "default"}
                        selected={size === mode}
                        title={`Ranked ${size}`}
                        hint={
                            open
                                ? `${squadSize(size)} units a side, ${cr(standing.budgets[size])} to spend at ${tier.name}`
                                : `No ${size} level yet`
                        }
                        commands={[
                            {
                                action: "confirm",
                                label: size === mode ? "Selected" : `Build ${size}`,
                                tone: "primary",
                                deny: open
                                    ? card
                                        ? "Searching for an opponent"
                                        : undefined
                                    : `No ${size} level yet`,
                                run: () => pickMode(size),
                            },
                        ]}
                    />
                );
            })}
            {notice && <p className="gui-note grk-notice">{notice}</p>}
        </div>
    );

    const run = () => {
        if (action.id === "sign-in") return ops.signIn();
        if (action.id === "resume") return ops.resume();
        if (squad) ops.find(mode, squad);
    };
    const find = (
        <ActionRow
            id="start"
            group="start"
            label={action.label}
            title={action.label}
            hint={action.hint}
            instant
            commands={[
                {
                    action: "confirm",
                    label: action.label,
                    tone: "primary",
                    deny: action.deny,
                    run,
                },
            ]}
        />
    );

    const searchingChip =
        full.phase === "searching" && full.sinceMs !== null
            ? clock(now - full.sinceMs)
            : card?.pending
              ? "Joining"
              : null;

    return (
        <FocusRoot back={back}>
            <ScreenFrame
                location={["Play", "Ranked"]}
                onLocation={ops.leave}
                status={
                    <>
                        {searchingChip && (
                            <StatusChip label="Match" value={searchingChip} state="live" />
                        )}
                        <StatusChip label="Rating" value={String(standing.rating)} />
                        <StatusChip label="Tier" value={tier.name} />
                        {standing.placementLeft > 0 && state.signedIn && (
                            <StatusChip
                                label="Placement"
                                value={`${standing.placementLeft} left`}
                            />
                        )}
                    </>
                }
                columns="minmax(0, 1fr)"
                commands={<FocusCommandBar glyphs={glyphs} />}
            >
                <SquadBuilder
                    mode={mode}
                    budget={budget}
                    rating={rating}
                    storageKey={STORE_KEY}
                    onChange={(units, found, labels) => setSquad({ units, issues: found, labels })}
                    aside={sizes}
                    action={find}
                    // A search on arrival (a reload, back from the menu) takes the cursor.
                    autoFocus={!card}
                    searching={!!card && card.phase !== "refused" && card.phase !== "expired"}
                    stageOverlay={
                        card && (
                            <SearchOverlay
                                card={card}
                                onBack={() =>
                                    card.phase === "searching" || card.phase === "timeout"
                                        ? ops.cancel()
                                        : ops.close()
                                }
                                onPrimary={() => {
                                    ops.close();
                                    if (squad && !action.deny) ops.find(mode, squad);
                                }}
                            />
                        )
                    }
                />
            </ScreenFrame>
        </FocusRoot>
    );
}

/** The search over the stage. Back cancels it, or closes a card that is only news. */
function SearchOverlay({
    card,
    onBack,
    onPrimary,
}: {
    card: SearchCard;
    onBack: () => void;
    onPrimary: () => void;
}) {
    const back: Command = {
        action: "back",
        label: card.back.label,
        deny: card.back.deny,
        run: onBack,
    };
    return (
        <FocusScope id="search" back={back} modal>
            <SearchBlock card={card} back={back} onPrimary={onPrimary} />
        </FocusScope>
    );
}

function SearchBlock({
    card,
    back,
    onPrimary,
}: {
    card: SearchCard;
    back: Command;
    onPrimary: () => void;
}) {
    const store = useFocusState();
    const { props } = useFocusable<HTMLDivElement>({
        id: "search-card",
        group: "search",
        title: card.title,
        hint: back.deny ?? card.hint,
        commands: card.primary
            ? [
                  { action: "confirm", label: card.primary.label, tone: "primary", run: onPrimary },
                  back,
              ]
            : [back],
    });
    useLayoutEffect(() => {
        store.focus("search-card", false);
    }, [store, card.phase]);
    return (
        <div className="grk-search" role="status" data-phase={card.phase} {...props}>
            <span className="gui-stage-eyebrow">{card.eyebrow}</span>
            <span className="grk-search-title">{card.title}</span>
            <dl className="grk-search-lines">
                {card.lines.map(([label, value]) => (
                    <div key={label}>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                    </div>
                ))}
            </dl>
        </div>
    );
}

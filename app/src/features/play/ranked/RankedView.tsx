// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Ranked: pick 3x3 or 4x4, build the squad within the tier's credit budget
 * (`SquadBuilder`), find an opponent. The search and the opponent are a mock
 * for now; every preset, item, price and number comes from the economy.
 */

import { useEffect, useLayoutEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

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
import { budgetOf, squadSize, tierOf, type Issue, type Loadout, type Mode } from "../economy";
import { stageMockMatch } from "../match";
import { useRating } from "../rating";
import {
    cr,
    emptySaved,
    issueText,
    opponentFor,
    parseSaved,
    seenNow,
    serializeSaved,
    SIZES,
    squadCost,
    STORE_KEY,
    tierNotice,
    type Saved,
} from "./model";
import { SquadBuilder } from "./SquadBuilder";
import "./ranked.css";

const SEARCH_MS = 2800;
const FOUND_MS = 1300;
/** The screen's own memory: the size last played and the tier last seen. */
const SCREEN_KEY = `${STORE_KEY}:screen`;

type Search = { phase: "searching" } | { phase: "found"; name: string; rating: number };

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

export function RankedView() {
    const glyphs = useGlyphSet();
    const navigate = useNavigate();
    const { rating } = useRating();
    const tier = tierOf(rating);

    const [screen, setScreen] = useState<Saved>(load);
    const mode = screen.mode;
    const budget = budgetOf(rating, mode);
    const [squad, setSquad] = useState<{
        units: Loadout[];
        issues: Issue[];
        labels: string[];
    } | null>(null);
    const [search, setSearch] = useState<Search | null>(null);
    // Said once, on arrival, when the tier changed since the last visit.
    const [notice, setNotice] = useState<string | null | undefined>(undefined);
    useEffect(() => {
        if (notice !== undefined || !squad) return;
        setNotice(tierNotice(screen, rating, mode, squad.units));
        save({ ...screen, seen: seenNow(rating, mode) });
    }, [squad]);
    useEffect(() => save({ ...screen, seen: seenNow(rating, mode) }), [mode]);

    const pickMode = (to: Mode) => {
        if (to !== mode) setScreen((s) => ({ ...s, mode: to }));
    };

    const issues = squad?.issues ?? [];
    const gate = !squad ? "Building the squad" : issues.length === 0 ? null : issueText(issues[0]);
    const spent = squad ? squadCost(squad.units) : 0;

    // The search: a few seconds, then an opponent, then the match.
    useEffect(() => {
        if (!search) return;
        if (search.phase === "searching") {
            const timer = window.setTimeout(
                () => setSearch({ phase: "found", ...opponentFor(rating) }),
                SEARCH_MS,
            );
            return () => window.clearTimeout(timer);
        }
        const timer = window.setTimeout(() => {
            const route = stageMockMatch({
                kind: "ranked",
                mode,
                squad: squad?.units ?? [],
                labels: squad?.labels,
                opponent: { name: search.name, rating: search.rating },
                returnTo: "/play/ranked",
            });
            navigate(route);
        }, FOUND_MS);
        return () => window.clearTimeout(timer);
        // The squad and mode cannot change while the search holds the screen.
    }, [search?.phase]);

    const leave = () => navigate("/play", { replace: true });
    const back: Command = { action: "back", label: "Back", run: leave };

    const sizes = (
        <div className="grk-sizes">
            {SIZES.map((size) => (
                <ListRow
                    key={size}
                    id={`size-${size}`}
                    group="side"
                    instant
                    name={`Ranked ${size}`}
                    kind={`${squadSize(size)} units a side`}
                    tag={`${cr(budgetOf(rating, size))} budget`}
                    tagTone={size === mode ? "accent" : "default"}
                    selected={size === mode}
                    title={`Ranked ${size}`}
                    hint={`${squadSize(size)} units a side, ${cr(budgetOf(rating, size))} to spend at ${tier.name}`}
                    commands={[
                        {
                            action: "confirm",
                            label: size === mode ? "Selected" : `Build ${size}`,
                            tone: "primary",
                            run: () => pickMode(size),
                        },
                    ]}
                />
            ))}
            {notice && <p className="gui-note grk-notice">{notice}</p>}
        </div>
    );

    const find = (
        <ActionRow
            id="start"
            group="start"
            label="Find ranked match"
            title="Find ranked match"
            hint={gate ?? "Search for an opponent near your rating"}
            instant
            commands={[
                {
                    action: "confirm",
                    label: "Find ranked match",
                    tone: "primary",
                    deny: gate ?? undefined,
                    run: () => setSearch({ phase: "searching" }),
                },
            ]}
        />
    );

    return (
        <FocusRoot back={back}>
            <ScreenFrame
                location={["Play", "Ranked"]}
                onLocation={leave}
                status={
                    <>
                        {search && (
                            <StatusChip
                                label="Match"
                                value={search.phase === "searching" ? "Searching" : "Found"}
                                state="live"
                            />
                        )}
                        <StatusChip label="Rating" value={String(rating)} />
                        <StatusChip label="Tier" value={tier.name} />
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
                    searching={!!search}
                    stageOverlay={
                        search && (
                            <SearchCard
                                search={search}
                                mode={mode}
                                rating={rating}
                                units={squad?.units.length ?? 0}
                                spent={spent}
                                onCancel={() => setSearch(null)}
                            />
                        )
                    }
                />
            </ScreenFrame>
        </FocusRoot>
    );
}

/** The search over the stage: who is looking, then who was found. Back cancels it. */
function SearchCard({
    search,
    mode,
    rating,
    units,
    spent,
    onCancel,
}: {
    search: Search;
    mode: Mode;
    rating: number;
    units: number;
    spent: number;
    onCancel: () => void;
}) {
    const back: Command = { action: "back", label: "Cancel search", run: onCancel };
    return (
        <FocusScope id="search" back={back} modal>
            <SearchBlock
                search={search}
                mode={mode}
                rating={rating}
                units={units}
                spent={spent}
                back={back}
            />
        </FocusScope>
    );
}

function SearchBlock({
    search,
    mode,
    rating,
    units,
    spent,
    back,
}: {
    search: Search;
    mode: Mode;
    rating: number;
    units: number;
    spent: number;
    back: Command;
}) {
    const store = useFocusState();
    const searching = search.phase === "searching";
    const { props } = useFocusable<HTMLDivElement>({
        id: "search-card",
        group: "search",
        title: searching ? "Looking for an opponent" : "Opponent found",
        hint: searching ? "A player near your rating" : "Taking you to the field",
        // Back is the one thing to do: the bar names it, nothing else is on offer.
        commands: [back],
    });
    useLayoutEffect(() => {
        store.focus("search-card", false);
    }, [store]);
    return (
        <div className="grk-search" role="status" data-phase={search.phase} {...props}>
            <span className="gui-stage-eyebrow">Ranked {mode}</span>
            <span className="grk-search-title">
                {searching ? "Looking for an opponent" : `Opponent found · ${search.name}`}
            </span>
            <dl className="grk-search-lines">
                {searching ? (
                    <>
                        <div>
                            <dt>Your rating</dt>
                            <dd>{rating}</dd>
                        </div>
                        <div>
                            <dt>Squad</dt>
                            <dd>
                                {units} units · {cr(spent)}
                            </dd>
                        </div>
                    </>
                ) : (
                    <>
                        <div>
                            <dt>Opponent</dt>
                            <dd>{search.name}</dd>
                        </div>
                        <div>
                            <dt>Their rating</dt>
                            <dd>{search.rating}</dd>
                        </div>
                    </>
                )}
            </dl>
        </div>
    );
}

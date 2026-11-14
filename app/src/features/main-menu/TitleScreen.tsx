// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The title screen in the shared interface language (`src/ui/`). The night
 * city (`TitleBackdrop`: the three.js set, a still poster while it starts)
 * fills the frame; a scrim darkens only the side the menu stands on, so the
 * street keeps its light. The wordmark and the menu share one column on the
 * left; the header carries the build line and the player's status chips; the
 * command bar names the focused row's command with the player's own glyphs.
 *
 * Fed by `src/screens/MainMenu.tsx` (the chain hooks live there); the row list
 * and the chips are the pure rules in `model.ts`.
 */

import {
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type CSSProperties,
    type ReactNode,
} from "react";

import { TitleBackdrop } from "../../components/TitleBackdrop";
import { useFitScale } from "../../hooks/useFitScale";
import { getSettings } from "../../settings/store";
import {
    ContextMenu,
    FocusCommandBar,
    FocusCursor,
    FocusRoot,
    headerClick,
    Prompt,
    StatusChip,
    useFocusable,
    useFocusStore,
    useGlyphSet,
    type Command,
} from "../../ui";
import {
    backTarget,
    matchChip,
    menuRows,
    playerChip,
    startRow,
    type MenuRow,
    type MenuState,
    type RowId,
} from "./model";
import "./title.css";

export type TitleData = {
    state: MenuState;
    /** When the search started, while in the queue. */
    searchingSinceMs: number | null;
    searchTimeoutMs: number;
    playerName: string;
    /** The last failed write (queueing, leaving the queue). */
    error: string | null;
    network: string;
    /** The build's commit, or empty on a dev build. */
    commit: string;
    source: string;
};

export type TitleOps = {
    run: (id: RowId) => void;
    cancelSearch: () => void;
    signIn: () => void;
    openPlayer: () => void;
    resumeMatch: () => void;
};

/**
 * On a phone held in landscape the desktop composition is scaled down as one
 * piece to this height (`useFitScale`), never re-flowed: everything the frame
 * holds at its tightest (rows at the phone height, the wordmark, the strips).
 */
const FIT_HEIGHT = 640;
const FIT_WIDTH = 900;

/** The full entrance plays once a session; coming back from a screen is a short fade. */
let introPlayed = false;
/** The row the player left the menu from, so Back from a screen lands on it. */
let lastRow: { id: RowId; index: number } | null = null;

type Intro = "full" | "quick" | "done";

const INTRO_MS: Record<Exclude<Intro, "done">, number> = { full: 1400, quick: 260 };

function prefersStill(): boolean {
    return (
        window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
        getSettings().display.reduceMotion
    );
}

export function TitleScreen({ data, ops }: { data: TitleData; ops: TitleOps }) {
    const rows = menuRows(data.state);
    const [prompt, setPrompt] = useState<"stop-search" | null>(null);
    const first = backTarget(rows);
    const back: Command = { action: "back", label: "Top", run: () => focusTop.current() };
    const focusTop = useRef(() => {});
    return (
        <div className="gui-title-screen">
            <TitleBackdrop />
            <div className="gui-title-scrim" aria-hidden />
            <FocusRoot back={back}>
                <TitleFrame
                    data={data}
                    ops={ops}
                    rows={rows}
                    first={first}
                    focusTop={focusTop}
                    onStopSearch={() => setPrompt("stop-search")}
                    overlay={
                        prompt === "stop-search" &&
                        data.searchingSinceMs !== null && (
                            <StopSearchPrompt
                                onStop={() => {
                                    setPrompt(null);
                                    ops.cancelSearch();
                                }}
                                onKeep={() => setPrompt(null)}
                            />
                        )
                    }
                />
            </FocusRoot>
        </div>
    );
}

function TitleFrame({
    data,
    ops,
    rows,
    first,
    focusTop,
    onStopSearch,
    overlay,
}: {
    data: TitleData;
    ops: TitleOps;
    rows: MenuRow[];
    first: RowId | null;
    focusTop: { current: () => void };
    onStopSearch: () => void;
    overlay: ReactNode;
}) {
    const root = useRef<HTMLElement | null>(null);
    const store = useFocusStore();
    const glyphs = useGlyphSet();
    const [intro, setIntro] = useState<Intro>(() =>
        prefersStill() ? "done" : introPlayed ? "quick" : "full",
    );
    useFitScale(root, { designHeight: FIT_HEIGHT, designWidth: FIT_WIDTH });

    focusTop.current = () => {
        if (first) store.focus(first);
    };

    // The cursor resumes on the row the player left from.
    useLayoutEffect(() => {
        store.focus(startRow(rows, lastRow), false);
        // Once, on arrival; later state changes keep the cursor where it is.
    }, [store]);

    // Remember where the cursor is for the next visit.
    useEffect(
        () =>
            store.subscribe(() => {
                const index = rows.findIndex((r) => r.id === store.focused);
                if (index >= 0) lastRow = { id: rows[index].id, index };
            }),
        [store, rows],
    );

    // The entrance runs on its own clock; any input skips to its end. Moving the
    // cursor, pressing or opening a list all go through the store, so it is
    // the one place to watch: no key listener of the screen's own.
    useEffect(() => {
        if (intro === "done") return;
        introPlayed = true;
        const skip = () => setIntro("done");
        const timer = window.setTimeout(skip, INTRO_MS[intro]);
        const start = store.focused;
        const off = store.subscribe(() => {
            if (store.pulse || store.menu || store.focused !== start) skip();
        });
        return () => {
            window.clearTimeout(timer);
            off();
        };
    }, [intro, store]);

    const run = (id: RowId) => ops.run(id);

    return (
        <main
            ref={root}
            className="gui ui-zoom gui-title"
            data-overlay={overlay ? "" : undefined}
            data-intro={intro}
            onPointerDown={() => intro !== "done" && setIntro("done")}
        >
            <i className="gui-corner" data-at="tl" aria-hidden />
            <i className="gui-corner" data-at="tr" aria-hidden />
            <i className="gui-corner" data-at="bl" aria-hidden />
            <i className="gui-corner" data-at="br" aria-hidden />
            <header className="gui-header gui-title-header">
                <BuildLine data={data} />
                <div className="gui-sections" />
                <div className="gui-status">
                    <MatchChipButton data={data} onStop={onStopSearch} onResume={ops.resumeMatch} />
                    <PlayerChipButton
                        signedIn={data.state.signedIn}
                        name={data.playerName}
                        onClick={data.state.signedIn ? ops.openPlayer : ops.signIn}
                    />
                </div>
            </header>
            <div className="gui-body gui-title-body">
                <section className="gui-title-column">
                    <Wordmark />
                    <p className="gui-title-pitch">
                        You run a mercenary squad. The corporations run everything else. Take the
                        contract, bring your people home, bill the client.
                    </p>
                    <nav className="gui-title-menu" aria-label="Main menu">
                        {rows.map((row, i) => (
                            <TitleRow key={row.id} row={row} index={i} onRun={run} />
                        ))}
                    </nav>
                    {data.error && (
                        <p className="gui-title-error" role="status">
                            <i className="gui-warn-mark" aria-hidden />
                            {data.error}
                        </p>
                    )}
                </section>
            </div>
            {overlay}
            <FocusCommandBar glyphs={glyphs} />
            <ContextMenu root={root} />
            <FocusCursor root={root} />
        </main>
    );
}

const NAV: Command = { action: "nav", label: "Move", glyph: "ud" };

/** One menu row: an index, the name, a short state; the band and a notch when focused. */
function TitleRow({
    row,
    index,
    onRun,
}: {
    row: MenuRow;
    index: number;
    onRun: (id: RowId) => void;
}) {
    const commands: Command[] = [
        NAV,
        {
            action: "confirm",
            label: row.verb,
            tone: row.primary ? "primary" : undefined,
            deny: row.locked,
            run: () => onRun(row.id),
        },
    ];
    const { props } = useFocusable<HTMLButtonElement>({
        id: row.id,
        group: "menu",
        title: row.label,
        hint: row.hint,
        commands,
        instant: row.instant,
    });
    return (
        <button
            type="button"
            tabIndex={-1}
            className="gui-title-row"
            data-locked={row.locked ? "" : undefined}
            data-primary={row.primary ? "" : undefined}
            aria-disabled={row.locked ? true : undefined}
            style={{ "--i": index } as CSSProperties}
            {...props}
        >
            <span className="gui-title-row-index">{String(index + 1).padStart(2, "0")}</span>
            <span className="gui-title-row-name">{row.label}</span>
            {row.tag && (
                <span className="gui-title-row-tag" data-tone={row.tagTone ?? "default"}>
                    {row.locked && <i className="gui-lock" aria-hidden />}
                    {row.tag}
                </span>
            )}
            <i className="gui-title-row-caret" aria-hidden />
        </button>
    );
}

/**
 * The logotype: six mono capitals as a drawing, scaled to the column, not
 * set in a type size. Each letter flickers on in turn during the entrance.
 */
function Wordmark() {
    const letters = "GHOSTS".split("");
    // IBM Plex Mono advances 0.6 em; 96-unit capitals, 0.42 em of tracking.
    const advance = 96 * 0.6 + 96 * 0.42;
    return (
        <h1 className="gui-title-mark">
            <svg viewBox={`0 0 ${Math.round(advance * 5 + 96 * 0.6)} 84`} role="img">
                <title>Ghosts</title>
                {letters.map((letter, i) => (
                    <text
                        key={i}
                        className="gui-title-letter"
                        x={i * advance}
                        y={78}
                        style={{ "--i": i } as CSSProperties}
                    >
                        {letter}
                    </text>
                ))}
            </svg>
            <i className="gui-title-sweep" aria-hidden />
        </h1>
    );
}

/** Network, build and source: the header's left slot, quiet; mouse-only links. */
function BuildLine({ data }: { data: TitleData }) {
    return (
        <div className="gui-where gui-title-build">
            <span>Sui · {data.network}</span>
            {data.commit ? (
                <a
                    href={`${data.source}/commit/${data.commit}`}
                    target="_blank"
                    rel="noreferrer"
                    tabIndex={-1}
                >
                    {data.commit.slice(0, 7)}
                </a>
            ) : (
                <span>dev build</span>
            )}
            <a href={data.source} target="_blank" rel="noreferrer" tabIndex={-1}>
                Source
            </a>
            <span>© Sui Potatoes</span>
        </div>
    );
}

/** The match chip: a click stops the search (after asking) or returns to the game. */
function MatchChipButton({
    data,
    onStop,
    onResume,
}: {
    data: TitleData;
    onStop: () => void;
    onResume: () => void;
}) {
    const store = useFocusStore();
    const now = useNow(data.searchingSinceMs !== null);
    const chip = matchChip(
        { playing: data.state.match.playing, searchingSinceMs: data.searchingSinceMs },
        now,
        data.searchTimeoutMs,
    );
    if (!chip) return null;
    return (
        <ChipButton
            onClick={() => {
                if (!headerClick(store)) return;
                if (data.state.match.playing) onResume();
                else onStop();
            }}
        >
            <StatusChip label="Match" value={chip.value} state={chip.state} tone={chip.tone} />
        </ChipButton>
    );
}

function PlayerChipButton({
    signedIn,
    name,
    onClick,
}: {
    signedIn: boolean;
    name: string;
    onClick: () => void;
}) {
    const store = useFocusStore();
    const chip = playerChip(signedIn, name);
    return (
        <ChipButton onClick={() => headerClick(store) && onClick()}>
            <StatusChip label="Player" value={chip.value} state={chip.idle ? "idle" : undefined} />
        </ChipButton>
    );
}

function ChipButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            tabIndex={-1}
            className="gui-title-chip"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

/** Opened from the match chip: leave the queue, or keep searching. */
function StopSearchPrompt({ onStop, onKeep }: { onStop: () => void; onKeep: () => void }) {
    const glyphs = useGlyphSet();
    return (
        <Prompt
            id="prompt-stop-search"
            eyebrow="Matchmaking"
            title="Stop searching?"
            confirm={{ label: "Stop", run: onStop }}
            cancel={{ label: "Keep searching", run: onKeep }}
            glyphs={glyphs}
        >
            The squad leaves the queue.
        </Prompt>
    );
}

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

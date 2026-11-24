// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The frame both Headquarters sections share, so Squad and Armory read as
 * two sections of one screen: the HQ breadcrumb with the Squad · Armory
 * switch, the command bar with a failed write on its amber line, the match
 * chip and the gates (signed out, closed, unreadable).
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { TICKET_TTL_MS } from "../../chain";
import { useGoUp } from "../../hooks/useGoUp";
import {
    barOf,
    CommandBar,
    EmptyState,
    headerClick,
    Prompt,
    ScreenFrame,
    StatusChip,
    useFocusState,
    useFocusStore,
    type GlyphSet,
} from "../../ui";
import "./squad/squad.css";

export type HqSection = "squad" | "armory";

const SECTIONS: { id: HqSection; label: string }[] = [
    { id: "squad", label: "Squad" },
    { id: "armory", label: "Armory" },
];

/** Why a section cannot open yet. */
export type HqGate = "disabled" | "signed-out" | "loading" | { error: string } | null;

/** The match search the header shows. */
export type MatchState = {
    searchingSince: number | null;
    playing: boolean;
    /** Another write is in flight: a cancel sent now would be dropped. */
    busy?: boolean;
    cancel(): void;
};

export type FrameBits = {
    status: ReactNode;
    overlay: ReactNode;
    glyphs: GlyphSet;
    onLeave: () => void;
    /** To the other section. */
    onSwitch: () => void;
    error: string;
    clearError: () => void;
};

export function HqFrame({
    section,
    frame,
    tabs,
    columns,
    focus,
    children,
}: {
    section: HqSection;
    frame: FrameBits;
    tabs?: ReactNode;
    columns: string;
    /** The group the cursor starts in. */
    focus?: string;
    children: ReactNode;
}) {
    const store = useFocusStore();
    useLayoutEffect(() => {
        if (focus) store.focusGroup(focus, true);
    }, [store, focus]);
    return (
        <ScreenFrame
            location={["HQ", section === "squad" ? "Squad" : "Armory"]}
            onLocation={frame.onLeave}
            siblings={{
                sections: SECTIONS,
                active: section,
                onSelect: (id) => id !== section && frame.onSwitch(),
                glyphs: frame.glyphs,
            }}
            tabs={tabs}
            status={frame.status}
            columns={columns}
            commands={
                <HqCommandBar
                    glyphs={frame.glyphs}
                    error={frame.error}
                    clearError={frame.clearError}
                />
            }
            overlay={frame.overlay}
        >
            {children}
        </ScreenFrame>
    );
}

/**
 * The shared command bar, plus the last write's failure as its amber line
 * until the cursor moves on (the module's refusal style, no banner).
 */
export function HqCommandBar({
    glyphs,
    error,
    clearError,
}: {
    glyphs: GlyphSet;
    error: string;
    clearError: () => void;
}) {
    const store = useFocusState();
    const { title, hint, commands, target } = barOf(store);
    const confirm = commands.find((c) => c.action === "confirm");
    const clear = useRef(clearError);
    clear.current = clearError;
    const shownAt = useRef<string | null>(null);
    useEffect(() => {
        if (!error) return;
        if (shownAt.current === null) shownAt.current = store.focused;
        else if (shownAt.current !== store.focused) {
            shownAt.current = null;
            clear.current();
        }
    }, [error, store.focused]);
    if (!error) shownAt.current = null;
    const pulse = store.pulse;
    return (
        <CommandBar
            title={title}
            hint={hint}
            deny={confirm?.deny ?? (error || undefined)}
            denyKey={store.denies + (error ? 1 : 0)}
            commands={commands.filter((c) => c.action !== "back")}
            back={store.command("back")!}
            glyphs={glyphs}
            pressed={pulse?.kind === "press" ? pulse.action : null}
            onRun={(command) => store.run(command, target)}
        />
    );
}

/** A section's gate: sign in, or a quiet plate when the game is closed or unreadable. */
export function HqGateView({
    section,
    gate,
    frame,
    onSignIn,
}: {
    section: HqSection;
    gate: Exclude<HqGate, null>;
    frame: FrameBits;
    onSignIn: () => void;
}) {
    const error = typeof gate === "object" ? gate.error : "";
    const what = section === "squad" ? "squad" : "armory";
    return (
        <HqFrame
            section={section}
            frame={{ ...frame, error: error || frame.error }}
            columns="minmax(0, 1fr)"
            focus={gate === "signed-out" ? "gate" : undefined}
        >
            {gate === "signed-out" ? (
                <EmptyState
                    id="gate-sign-in"
                    instant
                    group="gate"
                    headline="Sign in required"
                    action="Sign in"
                    title="Sign in"
                    hint={`Your ${what} is kept with your account`}
                    commands={[
                        { action: "confirm", label: "Sign in", tone: "primary", run: onSignIn },
                    ]}
                >
                    Sign in to see your {what}
                </EmptyState>
            ) : (
                <div className="gui-empty">
                    <span className="gui-void-mark" aria-hidden />
                    {error ? (
                        <>
                            <span className="gui-empty-headline">
                                {section === "squad" ? "Squad" : "Armory"} unavailable
                            </span>
                            <p className="gui-empty-body">
                                This version of the game can't read your {what}
                            </p>
                        </>
                    ) : (
                        gate === "disabled" && (
                            <span className="gui-empty-headline">Headquarters is closed</span>
                        )
                    )}
                </div>
            )}
        </HqFrame>
    );
}

/** Ticks once a second while mounted. */
function useNow(): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, []);
    return now;
}

/**
 * The match search in the header (the shell's floating chip stands aside on
 * these screens). A click on it is the mouse's way to stop searching or back
 * into a game in progress.
 */
export function MatchChip({ match, onSearch }: { match: MatchState; onSearch: () => void }) {
    const store = useFocusStore();
    const navigate = useNavigate();
    if (match.searchingSince === null && !match.playing) return null;
    return (
        <MatchChipBody
            match={match}
            onClick={() => {
                if (!headerClick(store)) return;
                if (match.playing) navigate("/match");
                else onSearch();
            }}
        />
    );
}

function MatchChipBody({ match, onClick }: { match: MatchState; onClick: () => void }) {
    const now = useNow();
    const elapsed = match.searchingSince === null ? 0 : now - match.searchingSince;
    const seconds = Math.floor(Math.min(Math.max(0, elapsed), TICKET_TTL_MS) / 1000);
    const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
    const timedOut = elapsed > TICKET_TTL_MS;
    return (
        <button
            type="button"
            tabIndex={-1}
            className="hqs-chip-button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={timedOut ? match.cancel : onClick}
        >
            {match.playing ? (
                <StatusChip label="Match" value="In progress" state="live" />
            ) : timedOut ? (
                <StatusChip label="Match" value="None found" tone="warn" />
            ) : (
                <StatusChip label="Match" value={`Searching ${clock}`} state="live" />
            )}
        </button>
    );
}

/** Leave Headquarters (either section) for the menu. */
export function useLeave() {
    return useGoUp();
}

/** Opened from the match chip: stop the search, or keep it. */
export function SearchPrompt({
    glyphs,
    onStop,
    onKeep,
    deny,
}: {
    glyphs: GlyphSet;
    onStop: () => void;
    onKeep: () => void;
    /** Why Stop cannot run yet. */
    deny?: string;
}) {
    return (
        <Prompt
            id="prompt-search"
            eyebrow="Queue"
            title="Stop searching?"
            confirm={{ label: "Stop", run: onStop, deny }}
            cancel={{ label: "Keep searching", run: onKeep }}
            glyphs={glyphs}
        >
            The squad leaves the queue
        </Prompt>
    );
}

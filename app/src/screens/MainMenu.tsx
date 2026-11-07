// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { useMatchSearch } from "../chain";
import { SearchClock } from "../components/MatchStatus";
import { TitleBackdrop } from "../components/TitleBackdrop";
import { PadHints } from "../components/PadHints";
import { NETWORK } from "../constants";
import { useMenuNav } from "../hooks/useMenuNav";
import { requestSignIn } from "../signIn";

const SOURCE = "https://github.com/sui-potatoes/ghosts";

type Entry = {
    label: string;
    /** Keeps the row, and its focus, when the label changes with its state. */
    id?: string;
    /** A right-aligned tag: why the entry is disabled, or its state. */
    tag?: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
};

/**
 * Title screen. The demos are local playtests; Headquarters keeps the squad on
 * chain and Find Match puts it in the queue, hiring one first for a player without.
 */
export default function MainMenu() {
    const navigate = useNavigate();
    const account = useCurrentAccount();
    // Up/Down and Confirm come off the input bus, whatever produced them.
    const items = useMenuNav(true);
    const match = useMatchSearch();

    // A suspension lifts on its own, while the menu is up.
    const [now, setNow] = useState(() => Date.now());
    const { suspendedUntilMs } = match;
    useEffect(() => {
        if (suspendedUntilMs <= Date.now()) return;
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [suspendedUntilMs]);
    const suspended = suspendedUntilMs > now;

    // One row through the search: find a match, leave the queue, get back to the game.
    const findMatch: Entry = match.playing
        ? { id: "match", label: "Resume Match", onClick: () => navigate("/match") }
        : suspended
          ? {
                id: "match",
                label: "Find Match",
                tag: `suspended ${Math.ceil((suspendedUntilMs - now) / 60_000)}m`,
                disabled: true,
            }
          : match.matched
            ? { id: "match", label: "Match Found", tag: "starting" }
            : match.searching
              ? {
                    id: "match",
                    label: "Cancel Search",
                    tag: <SearchClock sinceMs={Number(match.searching.sinceMs)} />,
                    onClick: match.cancel,
                }
              : {
                    id: "match",
                    label: "Find Match",
                    tag: match.hiring ? "hiring squad" : undefined,
                    onClick: account ? match.find : requestSignIn,
                };

    // The local playtest is available with or without a connected account.
    const entries: Entry[] = [
        // The playable contracts, named like the briefings name them: the
        // operation, with the location as the tag (scenario.ts carries both).
        { label: "Demo: Black Rain", tag: "Tokyo / Sector 09", onClick: () => navigate("/demo") },
        {
            label: "Demo: Paper Trail",
            tag: "Kōra HQ / Floor 07",
            onClick: () => navigate("/demo-2"),
        },
        ...(account ? [] : [{ label: "Login", onClick: requestSignIn }]),
        findMatch,
        { label: "Headquarters", onClick: () => navigate("/headquarters") },
        { label: "Level Editor", tag: "tool", onClick: () => navigate("/editor") },
        { label: "Leaderboard", tag: "soon", disabled: true },
        { label: "Settings", onClick: () => navigate("/settings") },
    ];

    return (
        <main className="main-menu flex min-h-screen flex-col px-6 md:px-16">
            <TitleBackdrop />
            <div className="relative z-10 flex w-full max-w-xl flex-1 flex-col justify-center gap-12 py-16">
                <header className="flex flex-col gap-5">
                    <h1 className="font-mono text-6xl font-light tracking-[0.3em] text-foreground md:text-7xl">
                        GHOSTS
                    </h1>
                    <p className="max-w-sm text-sm leading-relaxed text-secondary">
                        You run a mercenary squad. The corporations run everything else. Take the
                        contract, bring your people home, bill the client.
                    </p>
                </header>

                <nav aria-label="Main menu" className="flex flex-col border-t border-line">
                    {entries.map((e, i) => (
                        <button
                            key={e.id ?? e.label}
                            ref={(el) => {
                                items.current[i] = el;
                            }}
                            className="menu-item"
                            disabled={e.disabled}
                            aria-disabled={e.disabled}
                            onClick={e.onClick}
                        >
                            <span className="flex-1">{e.label}</span>
                            {e.tag && <span className="tag normal-case">{e.tag}</span>}
                        </button>
                    ))}
                </nav>
                {match.error && <p className="label -mt-8 normal-case text-warn">{match.error}</p>}

                <PadHints
                    entries={[
                        ["dpad", "Navigate"],
                        ["a", "Select"],
                    ]}
                />
            </div>

            <footer className="label relative z-10 flex flex-wrap items-baseline gap-x-6 gap-y-2 pb-8 text-muted">
                <span>Sui · {NETWORK}</span>
                {__COMMIT__ ? (
                    <a
                        className="normal-case"
                        href={`${SOURCE}/commit/${__COMMIT__}`}
                        target="_blank"
                        rel="noreferrer"
                    >
                        {__COMMIT__.slice(0, 7)}
                    </a>
                ) : (
                    <span>dev build</span>
                )}
                <span>© Sui Potatoes</span>
                <a href={SOURCE} target="_blank" rel="noreferrer">
                    Source
                </a>
            </footer>
        </main>
    );
}

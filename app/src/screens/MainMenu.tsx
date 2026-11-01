// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { useNavigate } from "react-router-dom";

import { TitleBackdrop } from "../components/TitleBackdrop";
import { PadHints } from "../components/PadHints";
import { NETWORK } from "../constants";
import { useMenuNav } from "../hooks/useMenuNav";
import { requestSignIn } from "../signIn";

const SOURCE = "https://github.com/sui-potatoes/ghosts";

type Entry = {
    label: string;
    /** Why the entry is disabled, shown as a right-aligned tag. */
    tag?: string;
    disabled?: boolean;
    onClick?: () => void;
};

/**
 * Title screen. The demos are local playtests; Headquarters keeps the squad on chain.
 * Networked modes remain disabled until their account flow is ready.
 */
export default function MainMenu() {
    const navigate = useNavigate();
    const account = useCurrentAccount();
    // Up/Down and Confirm come off the input bus, whatever produced them.
    const items = useMenuNav(true);

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
        { label: "Ranked", tag: "soon", disabled: true },
        { label: "Public", tag: "soon", disabled: true },
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
                            key={e.label}
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

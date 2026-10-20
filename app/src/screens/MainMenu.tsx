// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { useNavigate } from "react-router-dom";

import nightScene from "../assets/menu-night-1672.webp";
import nightSceneSmall from "../assets/menu-night-960.webp";
import { NETWORK } from "../constants";
import { requestSignIn } from "../signIn";

type Entry = {
    label: string;
    /** Why the entry is disabled, shown as a right-aligned tag. */
    tag?: string;
    disabled?: boolean;
    onClick?: () => void;
};

/**
 * Title screen. Demo and Squad are local, playable frontend experiences.
 * Networked modes remain disabled until their account flow is ready.
 */
export default function MainMenu() {
    const navigate = useNavigate();
    const account = useCurrentAccount();

    // The local playtest is available with or without a connected account.
    const entries: Entry[] = [
        { label: "Demo", onClick: () => navigate("/demo") },
        ...(account ? [] : [{ label: "Login", onClick: requestSignIn }]),
        { label: "Ranked", tag: "soon", disabled: true },
        { label: "Public", tag: "soon", disabled: true },
        { label: "Squad", onClick: () => navigate("/squad") },
        { label: "Leaderboard", tag: "soon", disabled: true },
        { label: "Settings", onClick: () => navigate("/settings") },
    ];

    return (
        <main className="main-menu flex min-h-screen flex-col justify-center px-6 py-16 md:px-16">
            <img
                className="main-menu-backdrop main-menu-image"
                src={nightScene}
                srcSet={`${nightSceneSmall} 960w, ${nightScene} 1672w`}
                sizes="100vw"
                width={1672}
                height={941}
                alt=""
                aria-hidden="true"
                fetchPriority="high"
                decoding="async"
            />
            <div className="relative z-10 flex w-full max-w-xl flex-col gap-12">
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
                    {entries.map((e) => (
                        <button
                            key={e.label}
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

                <footer className="label flex flex-wrap gap-x-6 gap-y-2 text-muted">
                    <span>
                        Sui · {NETWORK} <span className="text-muted">/</span> build 0.0.0
                    </span>
                    <span>© Sui Potatoes</span>
                    <a
                        href="https://github.com/sui-potatoes/ghosts"
                        target="_blank"
                        rel="noreferrer"
                    >
                        Source
                    </a>
                </footer>
            </div>
        </main>
    );
}

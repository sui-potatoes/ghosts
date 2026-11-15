// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The title screen at `/`, in the shared interface language
 * (`src/features/main-menu/`). This file feeds `TitleScreen` from the account,
 * the match search and the device; the rows and chips are `model.ts`.
 *
 * REVERTING: set `CLASSIC_TITLE` in `src/classicTitle.ts` to `true`. `/` then renders the classic
 * screen again (`MainMenuClassic.tsx`), the shell's floating match status
 * returns to it, and the sign-in and pause dialogs go back to their classic
 * versions (`SignInModal.tsx`, `PauseMenuClassic.tsx`). The classic title
 * stays reachable at `/menu-classic` either way.
 */

import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { SEARCH_TIMEOUT_MS, useMatchSearch } from "../chain";
import { NETWORK } from "../constants";
import { TitleScreen, type TitleData, type TitleOps } from "../features/main-menu/TitleScreen";
import type { RowId } from "../features/main-menu/model";
import { usePlayerName } from "../hooks/usePlayerName";
import { useInstall } from "../install";
import { requestSignIn } from "../signIn";
import { CLASSIC_TITLE } from "../classicTitle";
import MainMenuClassic from "./MainMenuClassic";
import { SOURCE_URL as SOURCE } from "../reportIssue";

export default function MainMenu() {
    return CLASSIC_TITLE ? <MainMenuClassic /> : <Title />;
}

function Title() {
    const navigate = useNavigate();
    const account = useCurrentAccount();
    const match = useMatchSearch();
    const install = useInstall();
    const { name } = usePlayerName();

    // A suspension lifts on its own, while the menu is up.
    const [now, setNow] = useState(() => Date.now());
    const { suspendedUntilMs } = match;
    useEffect(() => {
        if (suspendedUntilMs <= Date.now()) return;
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [suspendedUntilMs]);
    const suspendedMs = Math.max(0, suspendedUntilMs - now);

    const data: TitleData = {
        state: {
            signedIn: !!account,
            match: {
                playing: !!match.playing,
                searching: !!match.searching,
                hiring: match.hiring,
                suspendedMin: suspendedMs > 0 ? Math.ceil(suspendedMs / 60_000) : 0,
            },
            install: install.kind,
        },
        searchingSinceMs: match.searching ? Number(match.searching.sinceMs) : null,
        searchTimeoutMs: SEARCH_TIMEOUT_MS,
        playerName: name,
        error: match.error || null,
        network: NETWORK,
        commit: __COMMIT__ ?? "",
        source: SOURCE,
    };

    const ops: TitleOps = {
        run: (id: RowId) => {
            switch (id) {
                case "demo-black-rain":
                    return navigate("/demo");
                case "demo-paper-trail":
                    return navigate("/demo-2");
                case "sign-in":
                    return requestSignIn();
                case "match":
                    if (match.playing) return navigate("/match");
                    if (match.searching) return match.cancel();
                    return account ? match.find() : requestSignIn();
                case "headquarters":
                    return navigate("/headquarters");
                case "editor":
                    return navigate("/editor");
                case "install":
                    if (install.kind === "prompt") void install.install();
                    return;
                case "settings":
                    return navigate("/settings");
                case "leaderboard":
                    return;
            }
        },
        cancelSearch: match.cancel,
        signIn: requestSignIn,
        openPlayer: () => navigate("/settings"),
        resumeMatch: () => navigate("/match"),
    };

    return <TitleScreen data={data} ops={ops} />;
}

// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import MainMenu from "./screens/MainMenu";
import Settings from "./screens/Settings";
// Headquarters brings the squad's three.js studio; load it with the route,
// or ahead of it once a player is signed in (see `useHeadquartersAhead`).
const loadHeadquarters = () => import("./screens/Headquarters");
const loadArmory = () => import("./screens/Armory");
const Headquarters = lazy(loadHeadquarters);
const Armory = lazy(loadArmory);
// The encounter brings three.js and the combat assets; load it with the route.
const Demo = lazy(() => import("./screens/Demo"));
// A match is an encounter too, and brings the chain driver along.
const Match = lazy(() => import("./screens/Match"));
// The level editor brings three.js and the full asset catalog.
const Editor = lazy(() => import("./screens/Editor"));
import { SquadPreload, TransactionSender } from "./chain";
import { LoadingSpinner } from "./components/LoadingSpinner";
import { MatchStatus } from "./components/MatchStatus";
import { SaveIndicator } from "./components/SaveIndicator";
import { EscapeBack } from "./EscapeBack";
import { bindInput } from "./input";
import { playTheme, stopTheme } from "./audio";
import { onSignInRequest } from "./signIn";
import { SignInModal } from "./SignInModal";

/** The title theme runs behind the menu screens and bows out for the encounter. */
function MenuMusic() {
    const { pathname } = useLocation();
    const menu =
        pathname === "/" ||
        pathname.startsWith("/settings") ||
        pathname.startsWith("/headquarters");
    useEffect(() => {
        if (menu) playTheme();
        else stopTheme();
    }, [menu]);
    return null;
}

/**
 * A signed-in player is headed for Headquarters sooner or later: fetch its code
 * (and the Armory's) while the browser is idle, so opening it waits on nothing.
 * Signed out, the three.js studio is not worth the bandwidth yet.
 */
function useHeadquartersAhead() {
    const signedIn = !!useCurrentAccount();
    useEffect(() => {
        if (!signedIn) return;
        const load = () => void Promise.all([loadHeadquarters(), loadArmory()]).catch(() => {});
        // Safari has no idle callback; a short delay keeps first paint clear.
        if (typeof window.requestIdleCallback === "function") {
            const id = window.requestIdleCallback(load, { timeout: 5000 });
            return () => window.cancelIdleCallback(id);
        }
        const timer = window.setTimeout(load, 2000);
        return () => window.clearTimeout(timer);
    }, [signedIn]);
}

/** Shell: routes plus the one dialog every screen can summon. */
export function App() {
    const [signInOpen, setSignInOpen] = useState(false);

    useEffect(() => onSignInRequest(() => setSignInOpen(true)), []);
    // The one input binding: keyboard and controller onto the action bus.
    useEffect(bindInput, []);
    useHeadquartersAhead();

    return (
        <>
            <Routes>
                <Route index path="/" element={<MainMenu />} />
                <Route
                    path="/demo"
                    element={
                        <Suspense fallback={<LoadingSpinner />}>
                            <Demo />
                        </Suspense>
                    }
                />
                <Route
                    path="/demo-2"
                    element={
                        <Suspense fallback={<LoadingSpinner />}>
                            <Demo office />
                        </Suspense>
                    }
                />
                <Route
                    path="/match"
                    element={
                        <Suspense fallback={<LoadingSpinner />}>
                            <Match />
                        </Suspense>
                    }
                />
                <Route
                    path="/editor"
                    element={
                        <Suspense fallback={<LoadingSpinner />}>
                            <Editor />
                        </Suspense>
                    }
                />
                <Route path="/settings" element={<Settings />} />
                <Route
                    path="/headquarters"
                    element={
                        <Suspense fallback={<LoadingSpinner />}>
                            <Headquarters />
                        </Suspense>
                    }
                />
                <Route
                    path="/headquarters/armory"
                    element={
                        <Suspense fallback={<LoadingSpinner />}>
                            <Armory />
                        </Suspense>
                    }
                />
                <Route path="/squad" element={<Navigate to="/headquarters" replace />} />
                <Route path="/barracks" element={<Navigate to="/headquarters" replace />} />
            </Routes>
            <MenuMusic />
            <TransactionSender />
            <SquadPreload />
            <SaveIndicator />
            <MatchStatus />
            <EscapeBack />
            <SignInModal open={signInOpen} onClose={() => setSignInOpen(false)} />
        </>
    );
}

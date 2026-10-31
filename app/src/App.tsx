// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { lazy, Suspense, useEffect, useState } from "react";
import { Route, Routes, useLocation } from "react-router-dom";

import MainMenu from "./screens/MainMenu";
import Settings from "./screens/Settings";
const Squad = lazy(() => import("./screens/Squad"));
// The encounter brings three.js and the combat assets; load it with the route.
const Demo = lazy(() => import("./screens/Demo"));
// The level editor brings three.js and the full asset catalog.
const Editor = lazy(() => import("./screens/Editor"));
import { TransactionSender } from "./chain";
import { EscapeBack } from "./EscapeBack";
import { bindInput } from "./input";
import { playTheme, stopTheme } from "./audio";
import { onSignInRequest } from "./signIn";
import { SignInModal } from "./SignInModal";

/** The title theme runs behind the menu screens and bows out for the encounter. */
function MenuMusic() {
    const { pathname } = useLocation();
    const menu =
        pathname === "/" || pathname.startsWith("/settings") || pathname.startsWith("/squad");
    useEffect(() => {
        if (menu) playTheme();
        else stopTheme();
    }, [menu]);
    return null;
}

/** Shell: routes plus the one dialog every screen can summon. */
export function App() {
    const [signInOpen, setSignInOpen] = useState(false);

    useEffect(() => onSignInRequest(() => setSignInOpen(true)), []);
    // The one input binding: keyboard and controller onto the action bus.
    useEffect(bindInput, []);

    return (
        <>
            <Routes>
                <Route index path="/" element={<MainMenu />} />
                <Route
                    path="/demo"
                    element={
                        <Suspense fallback={<p className="label p-10">Bringing the squad in…</p>}>
                            <Demo />
                        </Suspense>
                    }
                />
                <Route
                    path="/demo-2"
                    element={
                        <Suspense fallback={<p className="label p-10">Opening the office…</p>}>
                            <Demo office />
                        </Suspense>
                    }
                />
                <Route
                    path="/editor"
                    element={
                        <Suspense fallback={<p className="label p-10">Opening the workshop…</p>}>
                            <Editor />
                        </Suspense>
                    }
                />
                <Route path="/settings" element={<Settings />} />
                <Route
                    path="/squad"
                    element={
                        <Suspense fallback={<p className="label p-10">Opening personnel bay…</p>}>
                            <Squad />
                        </Suspense>
                    }
                />
            </Routes>
            <MenuMusic />
            <TransactionSender />
            <EscapeBack />
            <SignInModal open={signInOpen} onClose={() => setSignInOpen(false)} />
        </>
    );
}

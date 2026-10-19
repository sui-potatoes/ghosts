// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { lazy, Suspense, useEffect, useState } from "react";
import { Route, Routes } from "react-router-dom";

import MainMenu from "./screens/MainMenu";
import Demo from "./screens/Demo";
import Settings from "./screens/Settings";
const Squad = lazy(() => import("./screens/Squad"));
import SceneStudy from "./screens/SceneStudy";
import { EscapeBack } from "./EscapeBack";
import { onSignInRequest } from "./signIn";
import { SignInModal } from "./SignInModal";

/** Shell: routes plus the one dialog every screen can summon. */
export function App() {
    const [signInOpen, setSignInOpen] = useState(false);

    useEffect(() => onSignInRequest(() => setSignInOpen(true)), []);

    return (
        <>
            <Routes>
                <Route index path="/" element={<MainMenu />} />
                <Route path="/demo" element={<Demo />} />
                <Route path="/settings" element={<Settings />} />
                <Route
                    path="/squad"
                    element={
                        <Suspense fallback={<p className="label p-10">Opening personnel bay…</p>}>
                            <Squad />
                        </Suspense>
                    }
                />
                <Route path="/scene-study" element={<SceneStudy />} />
            </Routes>
            <EscapeBack />
            <SignInModal open={signInOpen} onClose={() => setSignInOpen(false)} />
        </>
    );
}

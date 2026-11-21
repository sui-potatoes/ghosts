// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import { CLASSIC_TITLE } from "./classicTitle";
import { SignInDialog } from "./features/dialogs/SignInDialog";
import MainMenu from "./screens/MainMenu";
// The title before the shared interface language, kept until the new one is signed off.
const MainMenuClassic = lazy(() => import("./screens/MainMenuClassic"));
import FindMatch from "./screens/FindMatch";
import Settings from "./screens/Settings";
import SettingsClassic from "./screens/SettingsClassic";
// Headquarters brings the squad's three.js studio; load it with the route,
// or ahead of it once a player is signed in (see `useHeadquartersAhead`).
const loadHeadquarters = () => import("./screens/Headquarters");
// The screen before the shared interface language, kept until the new one is signed off.
const HeadquartersClassic = lazy(() => import("./screens/HeadquartersClassic"));
const ArmoryClassic = lazy(() => import("./screens/ArmoryClassic"));
const loadArmory = () => import("./screens/Armory");
const Headquarters = lazy(loadHeadquarters);
const Armory = lazy(loadArmory);
// The encounter brings three.js and the combat assets; load it with the route.
const Demo = lazy(() => import("./screens/Demo"));
// A match is an encounter too, and brings the chain driver along.
const Match = lazy(() => import("./screens/Match"));
// The level editor brings three.js and the full asset catalog.
const Editor = lazy(() => import("./screens/Editor"));
// Play modes: the cards are light; the squad builder loads with its route.
const PlayScreen = lazy(() => import("./features/play/PlayScreen"));
const RankedScreen = lazy(() =>
    import("./features/play/ranked").then((m) => ({ default: m.RankedScreen })),
);
const DemoScreen = lazy(() =>
    import("./features/play/demo").then((m) => ({ default: m.DemoScreen })),
);
const FriendlyScreen = lazy(() =>
    import("./features/play/friendly").then((m) => ({ default: m.FriendlyScreen })),
);
// A design sample of the shared menu language; no menu entry, no account.
const UiSample = lazy(() => import("./features/ui-sample/UiSample"));
// QA only: the match result over fixtures, registered in `VITE_RESULT_QA=1` builds.
const ResultQa = import.meta.env.VITE_RESULT_QA
    ? lazy(() => import("./features/debrief/qa"))
    : null;
// QA only: recruitment over fixtures, registered in `VITE_RECRUIT_QA=1` builds.
const RecruitQa = import.meta.env.VITE_RECRUIT_QA
    ? lazy(() => import("./features/headquarters/squad/qa"))
    : null;
// QA only: the find-match screen over fixtures, registered in `VITE_FIND_QA=1` builds.
const FindQa = import.meta.env.VITE_FIND_QA ? lazy(() => import("./features/find-match/qa")) : null;
// QA only: the friendly screen over fixtures, registered in `VITE_FRIENDLY_QA=1` builds.
const FriendlyQa = import.meta.env.VITE_FRIENDLY_QA
    ? lazy(() => import("./features/play/friendly/qa"))
    : null;
// QA only: ranked over fixtures (builder, search, reveal), registered in `VITE_RANKED_QA=1` builds.
const RankedQa = import.meta.env.VITE_RANKED_QA
    ? lazy(() => import("./features/play/ranked/qa"))
    : null;
// QA only: every look a game can be shown in, on Black Rain, registered in `VITE_LOOKS_QA=1` builds.
const LooksQa = import.meta.env.VITE_LOOKS_QA ? lazy(() => import("./features/looks/qa")) : null;
// QA only: the first-sign-in name prompt over fakes, registered in `VITE_NAME_QA=1` builds.
const NameQa = import.meta.env.VITE_NAME_QA ? lazy(() => import("./features/name-step/qa")) : null;
// Sound design: every sound slot to audition and the soundscape switch, in the dev server or `VITE_SOUNDS_QA=1` builds.
const SoundsQa =
    import.meta.env.DEV || import.meta.env.VITE_SOUNDS_QA
        ? lazy(() => import("./audio/audition/SoundsQa"))
        : null;
// The match viewer: `/watch` lists live matches, recent ones and the player's own;
// `/watch/<game>` a match on chain, live or as a replay.
const WatchList = lazy(() => import("./features/watch/WatchList"));
const ChainWatch = lazy(() => import("./features/watch/ChainWatch"));
// The ranked players and the tiers they spread over.
const Leaderboard = lazy(() => import("./screens/Leaderboard"));
import { FundsOnSignIn, SquadPreload, TransactionSender } from "./chain";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { LoadingSpinner } from "./components/LoadingSpinner";
import { MatchStatus } from "./components/MatchStatus";
import { NameStep } from "./features/name-step/NameStep";
import { RulesPreload } from "./features/play/economy/useEconomy";
import { forgetDeviceRecordings } from "./features/watch/forget";

// Older builds kept demo games on the device: cleared once per load.
forgetDeviceRecordings();
import { SaveIndicator } from "./components/SaveIndicator";
import { EscapeBack } from "./EscapeBack";
import { ScreenMotion } from "./ui/screen-motion";
import { bindInput } from "./input";
import { playTheme, stopTheme } from "./audio";
import { onSignInRequest } from "./signIn";
import { SignInModal } from "./SignInModal";

/** The title theme runs behind the menu screens and bows out for the encounter. */
function MenuMusic() {
    const { pathname } = useLocation();
    const menu =
        pathname === "/" ||
        pathname === "/menu-classic" ||
        pathname === "/play" ||
        pathname === "/watch" ||
        pathname === "/leaderboard" ||
        pathname.startsWith("/play/") ||
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
    const closeSignIn = useCallback(() => setSignInOpen(false), []);

    useEffect(() => onSignInRequest(() => setSignInOpen(true)), []);
    // The one input binding: keyboard and controller onto the action bus.
    useEffect(bindInput, []);
    useHeadquartersAhead();

    return (
        <>
            <Routes>
                <Route index path="/" element={<MainMenu />} />
                <Route
                    path="/menu-classic"
                    element={
                        <Suspense fallback={<LoadingSpinner />}>
                            <MainMenuClassic />
                        </Suspense>
                    }
                />
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
                <Route path="/find" element={<Navigate to="/play" replace />} />
                <Route
                    path="/play"
                    element={
                        <Suspense fallback={<LoadingSpinner />}>
                            <PlayScreen />
                        </Suspense>
                    }
                />
                <Route
                    path="/play/ranked"
                    element={
                        <Suspense fallback={<LoadingSpinner />}>
                            <RankedScreen />
                        </Suspense>
                    }
                />
                <Route
                    path="/play/friendly"
                    element={
                        <Suspense fallback={<LoadingSpinner />}>
                            <FriendlyScreen />
                        </Suspense>
                    }
                />
                <Route path="/play/contract" element={<FindMatch />} />
                <Route path="/play/demo" element={<Navigate to="/play/training" replace />} />
                <Route
                    path="/play/training"
                    element={
                        <Suspense fallback={<LoadingSpinner />}>
                            <DemoScreen />
                        </Suspense>
                    }
                />
                <Route
                    path="/match"
                    element={
                        <ErrorBoundary scope="match" fullScreen={false}>
                            <Suspense fallback={<LoadingSpinner />}>
                                <Match />
                            </Suspense>
                        </ErrorBoundary>
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
                <Route path="/settings-classic" element={<SettingsClassic />} />
                <Route
                    path="/headquarters"
                    element={
                        <Suspense fallback={<LoadingSpinner />}>
                            <Headquarters />
                        </Suspense>
                    }
                />
                <Route
                    path="/headquarters-classic"
                    element={
                        <Suspense fallback={<LoadingSpinner />}>
                            <HeadquartersClassic />
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
                <Route
                    path="/headquarters/armory-classic"
                    element={
                        <Suspense fallback={<LoadingSpinner />}>
                            <ArmoryClassic />
                        </Suspense>
                    }
                />
                <Route
                    path="/ui-sample"
                    element={
                        <Suspense fallback={<LoadingSpinner />}>
                            <UiSample />
                        </Suspense>
                    }
                />
                {SoundsQa && (
                    <Route
                        path="/sounds"
                        element={
                            <Suspense fallback={<LoadingSpinner />}>
                                <SoundsQa />
                            </Suspense>
                        }
                    />
                )}
                {LooksQa && (
                    <Route
                        path="/qa/looks"
                        element={
                            <Suspense fallback={<LoadingSpinner />}>
                                <LooksQa />
                            </Suspense>
                        }
                    />
                )}
                {ResultQa && (
                    <Route
                        path="/qa/match-result"
                        element={
                            <Suspense fallback={<LoadingSpinner />}>
                                <ResultQa />
                            </Suspense>
                        }
                    />
                )}
                {RecruitQa && (
                    <Route
                        path="/qa/recruitment"
                        element={
                            <Suspense fallback={<LoadingSpinner />}>
                                <RecruitQa />
                            </Suspense>
                        }
                    />
                )}
                {FindQa && (
                    <Route
                        path="/qa/find"
                        element={
                            <Suspense fallback={<LoadingSpinner />}>
                                <FindQa />
                            </Suspense>
                        }
                    />
                )}
                {RankedQa && (
                    <Route
                        path="/qa/ranked"
                        element={
                            <Suspense fallback={<LoadingSpinner />}>
                                <RankedQa />
                            </Suspense>
                        }
                    />
                )}
                {NameQa && (
                    <Route
                        path="/qa/name"
                        element={
                            <Suspense fallback={<LoadingSpinner />}>
                                <NameQa />
                            </Suspense>
                        }
                    />
                )}
                {FriendlyQa && (
                    <Route
                        path="/qa/friendly"
                        element={
                            <Suspense fallback={<LoadingSpinner />}>
                                <FriendlyQa />
                            </Suspense>
                        }
                    />
                )}
                <Route
                    path="/watch"
                    element={
                        <Suspense fallback={<LoadingSpinner />}>
                            <WatchList />
                        </Suspense>
                    }
                />
                <Route
                    path="/watch/:gameId"
                    element={
                        <Suspense fallback={<LoadingSpinner />}>
                            <ChainWatch />
                        </Suspense>
                    }
                />
                <Route
                    path="/leaderboard"
                    element={
                        <Suspense fallback={<LoadingSpinner />}>
                            <Leaderboard />
                        </Suspense>
                    }
                />
                <Route path="/squad" element={<Navigate to="/headquarters" replace />} />
                <Route path="/barracks" element={<Navigate to="/headquarters" replace />} />
            </Routes>
            <MenuMusic />
            <TransactionSender />
            <FundsOnSignIn />
            <SquadPreload />
            <RulesPreload />
            <SaveIndicator />
            <MatchStatus />
            <EscapeBack />
            <ScreenMotion />
            {CLASSIC_TITLE ? (
                <SignInModal open={signInOpen} onClose={closeSignIn} />
            ) : (
                <SignInDialog open={signInOpen} onClose={closeSignIn} />
            )}
            <NameStep />
        </>
    );
}

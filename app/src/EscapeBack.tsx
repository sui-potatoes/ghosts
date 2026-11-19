// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useSyncExternalStore } from "react";
import { useEffect } from "react";
import { useLocation } from "react-router-dom";

import { useBack } from "./hooks/useBack";
import { useGoUp } from "./hooks/useGoUp";
import { noteRoute } from "./routes";
import { screenOwnsBack, subscribeScreenBack } from "./ui/back";

/** Screens that handle the back action themselves: the menu has nowhere to
 * go, the encounter opens its pause menu, and the editor asks before leaving.
 * `/play/match` answers Back on every step (versus card, field, debrief). */
const OWN_BACK = new Set([
    "/",
    "/menu-classic",
    "/demo",
    "/demo-2",
    "/editor",
    "/match",
    "/play/match",
]);

/**
 * The back action (Escape by default) on any other screen goes up to the
 * parent screen, the menu (`routes.ts`), never back through visited places.
 * Dialogs register their own back handler above this one, so they close first.
 * A screen built on the shared interface (`<FocusRoot>`) claims Back while
 * mounted (`ui/back.ts`); this stands aside for it.
 */
export function EscapeBack() {
    const goUp = useGoUp();
    const { pathname } = useLocation();
    useEffect(() => noteRoute(pathname), [pathname]);
    const screenOwned = useSyncExternalStore(subscribeScreenBack, screenOwnsBack);

    useBack(OWN_BACK.has(pathname) || screenOwned ? null : goUp);

    return null;
}

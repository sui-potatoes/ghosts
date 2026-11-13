// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useSyncExternalStore } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useBack } from "./hooks/useBack";
import { screenOwnsBack, subscribeScreenBack } from "./ui/back";

/** Screens that handle the back action themselves: the menu has nowhere to
 * go, the encounter opens its pause menu, and the editor asks before leaving. */
const OWN_BACK = new Set(["/", "/demo", "/demo-2", "/editor", "/match"]);

/**
 * The back action (Escape by default) on any other screen goes back one
 * screen, or to the menu when the app was opened directly on a sub-route.
 * Dialogs register their own back handler above this one, so they close first.
 * A screen built on the shared interface (`<FocusRoot>`) claims Back while
 * mounted (`ui/back.ts`); this stands aside for it.
 */
export function EscapeBack() {
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const screenOwned = useSyncExternalStore(subscribeScreenBack, screenOwnsBack);

    useBack(
        OWN_BACK.has(pathname) || screenOwned
            ? null
            : () => {
                  const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
                  if (idx > 0) navigate(-1);
                  else navigate("/", { replace: true });
              },
    );

    return null;
}

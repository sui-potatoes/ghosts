// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useLocation, useNavigate } from "react-router-dom";

import { useBack } from "./hooks/useBack";

/** Screens that handle the back action themselves: the menu has nowhere to
 * go, the encounter opens its pause menu, and the editor asks before leaving. */
const OWN_BACK = new Set(["/", "/demo", "/demo-2", "/editor", "/match"]);

/**
 * The back action (Escape by default) on any other screen goes back one
 * screen, or to the menu when the app was opened directly on a sub-route.
 * Dialogs register their own back handler above this one, so they close first.
 */
export function EscapeBack() {
    const navigate = useNavigate();
    const { pathname } = useLocation();

    useBack(
        OWN_BACK.has(pathname)
            ? null
            : () => {
                  const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
                  if (idx > 0) navigate(-1);
                  else navigate("/", { replace: true });
              },
    );

    return null;
}

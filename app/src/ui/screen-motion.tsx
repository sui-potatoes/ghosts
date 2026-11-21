// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useLayoutEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

import { parentOf } from "../routes";
import { reducedMotion } from "./motion";
import { navMotion } from "./tactile-model";

/** Longer than the motion itself (gui.css, 170 ms): then the mark is cleared. */
const MARK_MS = 260;

/**
 * The one motion between screens: on a route change it marks `<html
 * data-nav="in" | "back">` for a moment, and the screen that mounts plays
 * its entrance from that (gui.css). Going in slides the next screen over;
 * going back reverses it. Section and tab switches don't move. Mounted
 * once in the shell.
 */
export function ScreenMotion() {
    const { pathname } = useLocation();
    const last = useRef<string | null>(null);
    useLayoutEffect(() => {
        const from = last.current;
        last.current = pathname;
        const motion = reducedMotion() ? null : navMotion(from, pathname, parentOf);
        if (!motion) return;
        const html = document.documentElement;
        html.dataset.nav = motion;
        const timer = window.setTimeout(() => {
            if (html.dataset.nav === motion) delete html.dataset.nav;
        }, MARK_MS);
        return () => {
            window.clearTimeout(timer);
            delete html.dataset.nav;
        };
    }, [pathname]);
    return null;
}

// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useEffect, useRef, useState } from "react";

import { observePad } from "@ghosts/engine/gamepad";
import source from "../assets/title-scene-poster.webp";
import sourceSmall from "../assets/title-scene-poster-960.webp";
import type { TitleCity } from "./title-city";

/** The running set, for the menu's confirm to nudge. */
let live: TitleCity | undefined;

/** A confirm on the title menu: the set answers with a small dip and flicker. */
export function nudgeTitleBackdrop() {
    live?.nudge();
}

/** The right stick's dead zone for the lean (the left one walks the menu). */
const STICK_DEADZONE = 0.2;

/**
 * The set leans a degree toward the mouse, or the pad's right stick; a
 * finger does nothing. The scene eases and gates it (still under reduced
 * motion) inside its own frame loop, so this only hands it the aim.
 */
function useLean(city: () => TitleCity | undefined) {
    useEffect(() => {
        const move = (e: PointerEvent) => {
            if (e.pointerType !== "mouse") return;
            city()?.lean(
                (e.clientX / window.innerWidth) * 2 - 1,
                -((e.clientY / window.innerHeight) * 2 - 1),
            );
        };
        const leave = () => city()?.lean(0, 0);
        let stick = false;
        const offPad = observePad((snap) => {
            const x = snap.axes[2] ?? 0;
            const y = snap.axes[3] ?? 0;
            const on = Math.hypot(x, y) > STICK_DEADZONE;
            if (!on && !stick) return;
            stick = on;
            city()?.lean(on ? x : 0, on ? -y : 0);
        });
        window.addEventListener("pointermove", move, { passive: true });
        document.documentElement.addEventListener("pointerleave", leave);
        return () => {
            offPad();
            window.removeEventListener("pointermove", move);
            document.documentElement.removeEventListener("pointerleave", leave);
        };
    }, [city]);
}

/** A captured frame of this scene covers loading and unavailable WebGL contexts. */
export function TitleBackdrop() {
    const host = useRef<HTMLDivElement>(null);
    const [ready, setReady] = useState(false);
    const [current] = useState(() => () => live);
    useLean(current);
    useEffect(() => {
        let cancelled = false;
        let city: TitleCity | undefined;
        // The poster covers the wait, so the scene starts once the menu has
        // painted and the browser is idle: the menu answers input from the start.
        const start = () =>
            void import("./title-city")
                .then(({ createTitleCity }) => {
                    if (!cancelled && host.current) {
                        city = createTitleCity(
                            host.current,
                            () => setReady(true),
                            () => setReady(false),
                        );
                        live = city;
                    }
                })
                .catch(() => {
                    if (!cancelled) setReady(false);
                });
        const idle = typeof window.requestIdleCallback === "function";
        const handle = idle
            ? window.requestIdleCallback(start, { timeout: 1200 })
            : window.setTimeout(start, 300);
        return () => {
            cancelled = true;
            if (idle) window.cancelIdleCallback(handle);
            else window.clearTimeout(handle);
            if (live === city) live = undefined;
            city?.dispose();
        };
    }, []);
    return (
        <>
            <img
                className="main-menu-backdrop main-menu-image"
                src={source}
                srcSet={`${sourceSmall} 960w, ${source} 1672w`}
                sizes="100vw"
                width={1672}
                height={941}
                alt=""
                aria-hidden="true"
                fetchPriority="high"
                decoding="async"
            />
            <div
                ref={host}
                className="main-menu-backdrop main-menu-scene"
                aria-hidden="true"
                data-ready={ready}
            />
        </>
    );
}

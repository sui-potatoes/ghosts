// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useEffect, useRef, useState, type CSSProperties } from "react";

import { observePad } from "@ghosts/engine/gamepad";
import source from "../assets/title-scene-poster.webp";
import sourceSmall from "../assets/title-scene-poster-960.webp";
import { reducedMotion } from "../ui/motion";
import type { TitleCity } from "./title-city";

/** The running set and the picture's pulse layer, for the menu's confirm to nudge. */
let live: TitleCity | undefined;
let pulseLayer: HTMLElement | null = null;

/**
 * The lean is a 2D shift of the whole picture, never a camera move: the 3D
 * set (its frozen mirror included) is not redrawn for it, and it runs on
 * the compositor at the display's own rate. The picture is drawn this much
 * larger than the frame, so the shift never shows an edge.
 */
const OVERSCAN = 1.045;
/** The largest shift, as a share of the picture: about a degree of look. */
const LEAN = { x: 0.016, y: 0.009 };
/** The right stick's dead zone for the lean (the left one walks the menu). */
const STICK_DEADZONE = 0.2;

function leanTransform(x: number, y: number): string {
    return `translate3d(${(-x * LEAN.x * 100).toFixed(3)}%, ${(y * LEAN.y * 100).toFixed(3)}%, 0) scale(${OVERSCAN})`;
}

/** A confirm on the title menu: the light flickers and the picture gives a small push in. */
export function nudgeTitleBackdrop() {
    live?.nudge();
    if (!pulseLayer?.animate || reducedMotion()) return;
    pulseLayer.animate(
        [{ transform: "scale(1)" }, { transform: "scale(1.006)" }, { transform: "scale(1)" }],
        {
            duration: 320,
            easing: "cubic-bezier(0.2, 0.7, 0.3, 1)",
        },
    );
}

/**
 * The picture leans toward the mouse, or the pad's right stick; a finger
 * does nothing. Held while Interface motion is below Full. One write per
 * frame at most while the pointer moves; the CSS transition eases it.
 */
function useLean(layer: { current: HTMLElement | null }) {
    useEffect(() => {
        let raf = 0;
        let aim = { x: 0, y: 0 };
        const apply = () => {
            raf = 0;
            const still = reducedMotion();
            if (layer.current)
                layer.current.style.transform = still
                    ? leanTransform(0, 0)
                    : leanTransform(aim.x, aim.y);
        };
        const set = (x: number, y: number) => {
            aim = { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) };
            if (!raf) raf = requestAnimationFrame(apply);
        };
        const move = (e: PointerEvent) => {
            if (e.pointerType !== "mouse") return;
            set(
                (e.clientX / window.innerWidth) * 2 - 1,
                -((e.clientY / window.innerHeight) * 2 - 1),
            );
        };
        const leave = () => set(0, 0);
        let stick = false;
        const offPad = observePad((snap) => {
            const x = snap.axes[2] ?? 0;
            const y = snap.axes[3] ?? 0;
            const on = Math.hypot(x, y) > STICK_DEADZONE;
            if (!on && !stick) return;
            stick = on;
            set(on ? x : 0, on ? -y : 0);
        });
        window.addEventListener("pointermove", move, { passive: true });
        document.documentElement.addEventListener("pointerleave", leave);
        return () => {
            cancelAnimationFrame(raf);
            offPad();
            window.removeEventListener("pointermove", move);
            document.documentElement.removeEventListener("pointerleave", leave);
        };
    }, [layer]);
}

const FRAME: CSSProperties = {
    position: "absolute",
    inset: 0,
    overflow: "hidden",
    pointerEvents: "none",
};
const LAYER: CSSProperties = { position: "absolute", inset: 0 };
/** The lean eases over a quarter second on the compositor; nothing runs while it rests. */
const LEAN_LAYER: CSSProperties = {
    ...LAYER,
    transition: "transform 260ms cubic-bezier(0.2, 0.7, 0.3, 1)",
    willChange: "transform",
};

/** A captured frame of this scene covers loading and unavailable WebGL contexts. */
export function TitleBackdrop() {
    const host = useRef<HTMLDivElement>(null);
    const lean = useRef<HTMLDivElement>(null);
    const pulse = useRef<HTMLDivElement>(null);
    const [ready, setReady] = useState(false);
    useLean(lean);
    useEffect(() => {
        pulseLayer = pulse.current;
        return () => {
            if (pulseLayer === pulse.current) pulseLayer = null;
        };
    }, []);
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
        <div style={FRAME} aria-hidden="true">
            <div ref={lean} style={{ ...LEAN_LAYER, transform: leanTransform(0, 0) }}>
                <div ref={pulse} style={LAYER}>
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
                </div>
            </div>
        </div>
    );
}

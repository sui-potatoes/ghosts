// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The glass of a menu screen: one fixed, pointer-transparent layer of faint
 * grain, a sheen and (with Display: Scanlines on) the scanlines, so the
 * interface reads as a screen in a device. It lies under the content, never
 * over text. Static: drawn once, never animated. With it, while a mouse is
 * the input in use, a soft light
 * follows the pointer and catches the panels' edges (`.gui-panel-light`).
 *
 * The light is one pointer listener for every mounted screen, throttled to a
 * frame: it writes `--gx` / `--gy` (the pointer in the screen's own,
 * zoom-corrected pixels) and `data-lit` on each screen root, and nothing
 * else. No loop runs while the pointer rests.
 */

import { useLayoutEffect, useRef } from "react";

import { getSettings } from "../settings/store";

type Lit = { root: HTMLElement; zoom: number };

const roots = new Set<Lit>();
let raf = 0;
let at: { x: number; y: number } | null = null;

function measure(lit: Lit) {
    lit.zoom = lit.root.getBoundingClientRect().width / lit.root.offsetWidth || 1;
}

function paint() {
    raf = 0;
    // Reads first, then writes: the screen's zoom (phone landscape, the
    // title's fit) can change under it.
    if (at) for (const lit of roots) measure(lit);
    for (const lit of roots) {
        if (!at) {
            delete lit.root.dataset.lit;
            continue;
        }
        lit.root.style.setProperty("--gx", `${(at.x / lit.zoom).toFixed(1)}px`);
        lit.root.style.setProperty("--gy", `${(at.y / lit.zoom).toFixed(1)}px`);
        lit.root.dataset.lit = "";
    }
}

function schedule() {
    if (!raf) raf = requestAnimationFrame(paint);
}

function move(e: PointerEvent) {
    // Display: Pointer light off: no light, and nothing written per move.
    if (e.pointerType !== "mouse" || !getSettings().display.pointerLight) {
        if (at) {
            at = null;
            schedule();
        }
        return;
    }
    at = { x: e.clientX, y: e.clientY };
    schedule();
}

/** The pointer left the window (or the window lost focus): the light goes out. */
function leave() {
    at = null;
    schedule();
}

function listen(on: boolean) {
    if (on) {
        window.addEventListener("pointermove", move, { passive: true });
        document.documentElement.addEventListener("pointerleave", leave);
        window.addEventListener("blur", leave);
    } else {
        window.removeEventListener("pointermove", move);
        document.documentElement.removeEventListener("pointerleave", leave);
        window.removeEventListener("blur", leave);
    }
}

/**
 * Light the screen around `inner` while it is mounted. Found from the layer
 * itself: a parent's ref is not attached yet when a child's effect runs.
 */
function useLight(inner: { current: HTMLElement | null }) {
    useLayoutEffect(() => {
        const el = inner.current?.closest<HTMLElement>(".gui");
        if (!el) return;
        const lit: Lit = { root: el, zoom: 1 };
        if (!roots.size) listen(true);
        roots.add(lit);
        schedule();
        return () => {
            roots.delete(lit);
            if (!roots.size) {
                listen(false);
                cancelAnimationFrame(raf);
                raf = 0;
            }
        };
    }, [inner]);
}

/** The screen's glass and its pointer light; rendered once inside each screen frame. */
export function GuiSurface() {
    const glow = useRef<HTMLElement>(null);
    useLight(glow);
    return (
        <>
            <i ref={glow} className="gui-glow" aria-hidden />
            <i className="gui-surface" aria-hidden />
        </>
    );
}

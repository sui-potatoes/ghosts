// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The podium diorama as React: the canvas (`podium-scene.ts`, loaded on its
 * own chunk), and each podium as one cursor target whose box spans the figure
 * and its engraved base plate. Shared by the match's squad selection
 * (`SquadSelect.tsx`) and the `/ui-sample` deploy and debrief.
 */

import type { Recruit } from "@ghosts/squad/types";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { InlineCommands, useFocusable, type Command } from "../../ui";
import type { Anchor, PodiumScene } from "./podium-scene";
import "./squad-view.css";

type CanvasProps = {
    /** One per podium, left to right; their number at mount is the row's length. */
    figures: (Recruit | null)[];
    /** Full-detail figures (the studio's): only for comparing costs. */
    full?: boolean;
    /** Each podium lit by its own lamps only, struck on (recruitment). */
    projector?: boolean;
    focus: number | null;
    lit: boolean[];
    /** Podiums whose built figure stays out of the picture (default: all shown). */
    hidden?: boolean[];
    /** Lights change without the fade (reduced motion, a fixture switch). */
    instant?: boolean;
    turn?: number;
    /** The podium being inspected (a glance of light on a dark one). */
    inspect?: number | null;
    /** Motion reduced by the game's own setting: focus and lights jump (the OS preference always counts). */
    still?: boolean;
    onAnchors: (anchors: Anchor[]) => void;
    onState?: (state: { loading: boolean; error?: string }) => void;
};

export function PodiumCanvas({
    figures,
    full = false,
    projector = false,
    focus,
    lit,
    hidden,
    instant,
    turn,
    inspect = null,
    still = false,
    onAnchors,
    onState,
}: CanvasProps) {
    const host = useRef<HTMLDivElement>(null);
    const scene = useRef<PodiumScene | null>(null);
    const [ready, setReady] = useState(false);
    const layout = useRef(onAnchors);
    layout.current = onAnchors;
    const report = useRef(onState);
    report.current = onState;

    const count = useRef(figures.length);
    const detail = useRef(full);
    const lamps = useRef(projector);
    const calm = useRef(still);
    calm.current = still;
    useEffect(() => {
        let cancelled = false;
        void import("./podium-scene")
            .then(({ createPodiumScene }) => {
                if (cancelled || !host.current) return;
                const view = createPodiumScene(host.current, (anchors) => layout.current(anchors), {
                    count: count.current,
                    full: detail.current,
                    projector: lamps.current,
                    still: () => calm.current,
                });
                scene.current = view;
                layout.current(view.anchors());
                // For measuring: the frame cost, readable from the console.
                (window as { __podiums?: PodiumScene }).__podiums = view;
                setReady(true);
            })
            .catch((e) => report.current?.({ loading: false, error: String(e) }));
        return () => {
            cancelled = true;
            const w = window as { __podiums?: PodiumScene };
            if (scene.current && w.__podiums === scene.current) delete w.__podiums;
            scene.current?.dispose();
            scene.current = null;
        };
    }, []);

    const key = JSON.stringify(
        figures.map((f) => f && [f.id, f.equipment, f.attachments, f.weaponSkin]),
    );
    useEffect(() => {
        if (!ready) return;
        let cancelled = false;
        report.current?.({ loading: true });
        // Previews under a moving cursor settle before a rebuild.
        const timer = window.setTimeout(() => {
            void scene.current
                ?.setFigures(figures)
                .then(() => !cancelled && report.current?.({ loading: false }))
                .catch(
                    (e) =>
                        !cancelled &&
                        report.current?.({
                            loading: false,
                            error: e instanceof Error ? e.message : String(e),
                        }),
                );
        }, 120);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
        // The key stands for the figures.
    }, [ready, key]);

    useEffect(() => {
        if (ready) scene.current?.focus(focus);
    }, [ready, focus]);

    const litKey = lit.join();
    useEffect(() => {
        if (ready) lit.forEach((on, i) => scene.current?.setLit(i, on, instant));
        // The key stands for the flags.
    }, [ready, litKey, instant]);

    const hiddenKey = (hidden ?? []).join();
    useEffect(() => {
        // After the figures: a rebuild keeps what was set.
        if (ready && hidden) hidden.forEach((h, i) => scene.current?.setShown(i, !h));
        // The key stands for the flags.
    }, [ready, hiddenKey, key]);

    useEffect(() => {
        if (ready) scene.current?.inspect(inspect);
    }, [ready, inspect]);

    useEffect(() => {
        if (ready && turn !== undefined) scene.current?.turn(turn);
    }, [ready, turn]);

    return <div ref={host} className="sqv-diorama-canvas" />;
}

type PodiumProps = {
    index: number;
    anchor?: Anchor;
    title: string;
    hint?: string;
    commands: Command[];
    directions?: (dir: "up" | "down" | "left" | "right") => boolean;
    /** Dimmed: a recruit picker is choosing for another podium. */
    dim?: boolean;
    /** The engraved base plate. */
    children: ReactNode;
};

/** The engraved plate's height below the plinth's front edge (px). */
const PLATE_HEIGHT = 96;

/** A podium's column on the canvas, from the figure's head down to its plate. */
export function podiumBox(anchor?: Anchor) {
    return anchor
        ? {
              left: anchor.x - anchor.width / 2,
              width: anchor.width,
              top: anchor.top,
              height: Math.max(0, anchor.base - anchor.top) + PLATE_HEIGHT,
          }
        : { display: "none" as const };
}

/** One podium as a cursor target: the figure's column, down to its plate. */
export function Podium({
    index,
    anchor,
    title,
    hint,
    commands,
    directions,
    dim,
    children,
}: PodiumProps) {
    const { props, inline } = useFocusable<HTMLDivElement>({
        id: `podium-${index}`,
        group: "podiums",
        title,
        hint,
        commands,
        directions,
        // A podium's primary opens the operative picker: one click does it.
        instant: true,
    });
    const style = podiumBox(anchor);
    return (
        <div className="sqv-podium" style={style} data-dim={dim || undefined} {...props}>
            <div className="sqv-plate-mount">
                {inline && <InlineCommands commands={commands} />}
                {children}
            </div>
        </div>
    );
}

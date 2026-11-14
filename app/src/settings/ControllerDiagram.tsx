// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useEffect, useMemo, useRef } from "react";

import { heldPadButtons, observePad, padGlyph, type PadButton } from "@ghosts/engine/gamepad";
import {
    PAD_COMBAT_ACTIONS,
    PAD_COMBAT_LABELS,
    type PadBindable,
    type PadCombatAction,
    type PadCombatBindings,
} from "@ghosts/engine/keys";

import diagram from "./controller-diagram.svg?raw";
import "./controller.css";

/**
 * The hand-drawn pad diagram (cleaned from the repo-root controller.svg by
 * scripts/controller-svg/clean.ts): every control carries its field action on
 * the artist's leader lines, pressed buttons light up and the stick caps
 * follow the real sticks. Shared by the classic Controller panel and the
 * Settings screen in the shared interface language.
 */

// The diagram asset: the art without its <svg> wrapper (re-wrapped below so
// the label layer shares its coordinate space), and the label anchors the
// cleanup script derived from the artist's leader lines.

const ART = diagram.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");

interface Anchor {
    id: string;
    x: number;
    y: number;
    align: "start" | "end" | "middle";
}

const ANCHORS: Anchor[] = [
    ...diagram.matchAll(
        /<g id="(ctl-[\w-]+)"[^>]*data-label-x="([-\d.]+)" data-label-y="([-\d.]+)" data-label-anchor="(\w+)"/g,
    ),
].map((m) => ({
    id: m[1],
    x: parseFloat(m[2]),
    y: parseFloat(m[3]),
    align: m[4] as Anchor["align"],
}));

/** The action label at a leader line: shorter than the row labels where the
 *  art is cramped. */
export const DIAGRAM_LABELS: Record<PadCombatAction, string> = {
    ...PAD_COMBAT_LABELS,
    fire: "Fire",
    grenade: "Grenade",
};

type DiagramSpec = [prefix: PadButton | "ls" | "rs" | "", action: string];

/**
 * The field action each control performs, on its label row, derived from the
 * live bindings; the fixed controls keep their fixed words. The physical
 * button is named only where the art does not name it itself; an unbound
 * control keeps the name alone.
 */
function diagramActions(binds: PadCombatBindings): Record<string, DiagramSpec> {
    const of = (b: PadBindable) => {
        const action = PAD_COMBAT_ACTIONS.find((a) => binds[a] === b);
        return action ? DIAGRAM_LABELS[action] : "";
    };
    // The right stick is the camera whatever R3's click does; a non-default
    // click action rides along on its label.
    const focus = of("r3");
    return {
        "ctl-rt": ["rt", of("rt")],
        "ctl-rb": ["rb", of("rb")],
        "ctl-lt": ["lt", of("lt")],
        "ctl-lb": ["lb", of("lb")],
        "ctl-y": ["", of("y")],
        "ctl-x": ["", of("x")],
        "ctl-select": ["", of("select")],
        "ctl-b": ["", "Cancel / deselect"],
        "ctl-a": ["", "Confirm"],
        "ctl-start": ["", "Pause"],
        "ctl-stick-left": ["ls", "Cursor / pan"],
        "ctl-stick-right": [
            "rs",
            !focus || focus === "Camera focus" ? "Camera" : `Camera · ${focus}`,
        ],
        "ctl-up": ["", "Cursor up"],
        "ctl-down": ["", "Cursor down"],
        "ctl-left": ["", "Cursor left"],
        "ctl-right": ["", "Cursor right"],
    };
}

/** The engine button a diagram group stands for, for live highlighting. */
function padOf(id: string): PadButton {
    if (id === "ctl-stick-left") return "l3";
    if (id === "ctl-stick-right") return "r3";
    return id.slice(4) as PadButton;
}

/** What each physical button does, for the button test readout. */
export function fieldActions(binds: PadCombatBindings): Map<PadButton, string> {
    const m = new Map<PadButton, string>([
        ["a", "Confirm"],
        ["b", "Cancel / deselect"],
        ["start", "Pause"],
        ["l3", "Cursor / pan"],
        ["up", "Cursor up"],
        ["down", "Cursor down"],
        ["left", "Cursor left"],
        ["right", "Cursor right"],
    ]);
    for (const action of PAD_COMBAT_ACTIONS) {
        const b = binds[action];
        if (b) m.set(b, DIAGRAM_LABELS[action]);
    }
    return m;
}

// The label layer extends the art's 100×100 box; size the viewBox so the
// longest row on each side fits (mono advance ≈ 0.68em at the label size).
const FONT = 2.6;
const CHAR = FONT * 0.68;
const GAP = 1.5;
const PREFIX = 5; // "R2 · ", every prefix is two characters

function viewBox(actions: Record<string, DiagramSpec>): string {
    let minX = 0;
    let maxX = 100;
    for (const { id, x, align } of ANCHORS) {
        const spec = actions[id];
        if (!spec || (!spec[0] && !spec[1])) continue;
        const width = ((spec[0] ? PREFIX : 0) + spec[1].length) * CHAR + GAP;
        if (align === "start") maxX = Math.max(maxX, x + width);
        if (align === "end") minX = Math.min(minX, x - width);
    }
    return `${(minX - 2).toFixed(1)} 10 ${(maxX - minX + 4).toFixed(1)} 84`;
}

const STICK_TRAVEL = 1.8; // in art units; the cap wells are ~4 wide

export function ControllerDiagram({
    binds,
    pad,
    className = "ctl-svg",
}: {
    binds: PadCombatBindings;
    /** The connected pad family, "" when none. */
    pad: string;
    className?: string;
}) {
    const root = useRef<SVGSVGElement | null>(null);
    const actions = useMemo(() => diagramActions(binds), [binds]);
    const box = useMemo(() => viewBox(actions), [actions]);

    // Pressed buttons and the stick axes drive the DOM directly, outside
    // React: data-held on every element of the button's group and label,
    // a translate on the stick caps.
    useEffect(() => {
        const svg = root.current;
        if (!svg) return;
        const byPad = new Map<string, Element[]>();
        for (const el of svg.querySelectorAll("[data-pad]")) {
            const b = el.getAttribute("data-pad")!;
            byPad.set(b, [...(byPad.get(b) ?? []), el]);
        }
        const caps = [svg.querySelector('[data-stick="0"]'), svg.querySelector('[data-stick="1"]')];
        let prev: PadButton[] = [];
        return observePad((snap) => {
            const held = heldPadButtons(snap);
            for (const b of prev)
                if (!held.includes(b))
                    for (const el of byPad.get(b) ?? []) el.removeAttribute("data-held");
            for (const b of held)
                if (!prev.includes(b))
                    for (const el of byPad.get(b) ?? []) el.setAttribute("data-held", "");
            prev = held;
            caps[0]?.setAttribute(
                "transform",
                `translate(${(snap.axes[0] ?? 0) * STICK_TRAVEL} ${(snap.axes[1] ?? 0) * STICK_TRAVEL})`,
            );
            caps[1]?.setAttribute(
                "transform",
                `translate(${(snap.axes[2] ?? 0) * STICK_TRAVEL} ${(snap.axes[3] ?? 0) * STICK_TRAVEL})`,
            );
        });
    }, []);

    return (
        <svg
            ref={root}
            className={className}
            viewBox={box}
            role="img"
            aria-label={
                pad === "ps"
                    ? "PlayStation controller diagram"
                    : pad === "xbox"
                      ? "Xbox controller diagram"
                      : "Controller diagram"
            }
            data-connected={pad ? "" : undefined}
        >
            <g dangerouslySetInnerHTML={{ __html: ART }} />
            <g aria-hidden>
                {ANCHORS.map(({ id, x, y, align }) => {
                    const spec = actions[id];
                    if (!spec || (!spec[0] && !spec[1])) return null;
                    const [prefix, action] = spec;
                    const tx = align === "start" ? x + GAP : align === "end" ? x - GAP : x;
                    return (
                        <text key={id} x={tx} y={y} textAnchor={align} data-pad={padOf(id)}>
                            {prefix ? (
                                <tspan className="ctl-glyph">
                                    {action ? `${padGlyph(prefix)} · ` : padGlyph(prefix)}
                                </tspan>
                            ) : null}
                            {action}
                        </text>
                    );
                })}
            </g>
        </svg>
    );
}

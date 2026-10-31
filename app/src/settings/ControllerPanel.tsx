// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";

import {
    heldPadButtons,
    observePad,
    padGlyph,
    padName,
    type PadButton,
} from "@ghosts/engine/gamepad";

import { usePad } from "../components/PadHints";
import { SettingList, type SettingRow } from "./SettingList";

/**
 * The controller category: a live render of the connected pad family — a
 * DualSense for PlayStation, the asymmetric layout for Xbox — where pressed
 * buttons light up and the stick nubs follow the real sticks, over the fixed
 * bindings for the menus and the field. Nothing to configure yet; this page
 * is the reference the hints bars abbreviate.
 */

const g = (...buttons: (PadButton | "dpad" | "ls" | "rs")[]) => buttons.map(padGlyph).join("  ");

function rows(pad: string): SettingRow[] {
    const stat = (id: string, label: string, value: string, description: string): SettingRow => ({
        kind: "static",
        id,
        label,
        description,
        value,
    });
    return [
        stat(
            "status",
            "Device",
            pad ? padName() || "Controller" : "Not connected",
            pad
                ? "Standard-mapped controller. Press buttons to see them on the diagram."
                : "Connect a controller and press any button to wake it.",
        ),
        { kind: "section", id: "menus", label: "Menus" },
        stat("m-nav", "Navigate", g("dpad", "ls"), "Walk menu entries and setting rows."),
        stat("m-change", "Change value", "◀  ▶", "Cycle a choice or step a slider."),
        stat("m-select", "Select", g("a"), "Activate the focused entry."),
        stat("m-back", "Back", g("b", "start"), "Close the dialog, or leave the screen."),
        stat("m-cat", "Category", g("lb", "rb"), "Previous or next settings category."),
        stat("m-reset", "Reset setting", g("x"), "Return the focused setting to its default."),
        { kind: "section", id: "combat", label: "Combat" },
        stat(
            "c-cursor",
            "Cursor / aim",
            g("dpad", "ls"),
            "Move the tile cursor, nudge the throw, or walk targets.",
        ),
        stat(
            "c-confirm",
            "Confirm",
            g("a"),
            "Move to the cursor, take the shot, throw the grenade.",
        ),
        stat(
            "c-cancel",
            "Cancel / pause",
            g("b"),
            "Leave targeting; with nothing to cancel, pause.",
        ),
        stat(
            "c-wheel",
            "Action wheel",
            g("y"),
            "Orders on a ring: fire, grenade, overwatch, hunker, reload, extract, end turn.",
        ),
        stat("c-operator", "Operator", g("lb", "rb"), "Previous or next operator."),
        stat("c-fire", "Fire mode", g("rt"), "Raise the weapon at the best target."),
        stat("c-grenade", "Grenade mode", g("lt"), "Arm a grenade at the default landing point."),
        stat("c-reload", "Reload", g("x"), "Fresh magazine for the selected operator."),
        stat(
            "c-camera",
            "Camera",
            g("rs"),
            "Turn the field in quarter steps; click to focus the operator.",
        ),
        stat("c-grid", "Tactical grid", g("select"), "Toggle the grid overlay."),
        stat("c-pause", "Pause", g("start"), "The pause menu, any time."),
    ];
}

type On = (b: PadButton) => CSSProperties | undefined;
type Sticks = RefObject<(SVGGElement | null)[]>;

/** A d-pad of four separate arms around (cx, cy); PS and Xbox share it. */
function Dpad({
    cx,
    cy,
    on,
    arm = 18,
    len = 22,
    gap = 2,
}: {
    cx: number;
    cy: number;
    on: On;
    arm?: number;
    len?: number;
    gap?: number;
}) {
    const half = arm / 2;
    return (
        <>
            <rect
                x={cx - half}
                y={cy - half - gap - len}
                width={arm}
                height={len}
                rx={5}
                style={on("up")}
            />
            <rect
                x={cx - half}
                y={cy + half + gap}
                width={arm}
                height={len}
                rx={5}
                style={on("down")}
            />
            <rect
                x={cx - half - gap - len}
                y={cy - half}
                width={len}
                height={arm}
                rx={5}
                style={on("left")}
            />
            <rect
                x={cx + half + gap}
                y={cy - half}
                width={len}
                height={arm}
                rx={5}
                style={on("right")}
            />
        </>
    );
}

/** The four face buttons around (cx, cy), labeled with the family's glyphs. */
function FaceButtons({
    cx,
    cy,
    on,
    r = 11,
    spread = 28,
}: {
    cx: number;
    cy: number;
    on: On;
    r?: number;
    spread?: number;
}) {
    const spots: [PadButton, number, number][] = [
        ["y", cx, cy - spread],
        ["a", cx, cy + spread],
        ["x", cx - spread, cy],
        ["b", cx + spread, cy],
    ];
    return (
        <>
            {spots.map(([b, x, y]) => (
                <circle key={b} cx={x} cy={y} r={r} style={on(b)} />
            ))}
            {spots.map(([b, x, y]) => (
                <text key={`t-${b}`} x={x} y={y}>
                    {padGlyph(b)}
                </text>
            ))}
        </>
    );
}

/** A stick well and its nub; the nub group follows the real stick. */
function Stick({
    cx,
    cy,
    on,
    button,
    nub,
    sticks,
    slot,
}: {
    cx: number;
    cy: number;
    on: On;
    button: PadButton;
    nub: number;
    sticks: Sticks;
    slot: number;
}) {
    return (
        <>
            <circle cx={cx} cy={cy} r={nub + 6} className="pad-well" />
            <g
                ref={(el) => {
                    sticks.current[slot] = el;
                }}
            >
                <circle cx={cx} cy={cy} r={nub} style={on(button)} />
            </g>
        </>
    );
}

/** Bumpers and triggers along the top edge. */
function Shoulders({ on }: { on: On }) {
    return (
        <>
            <rect x={94} y={2} width={40} height={12} rx={6} style={on("lt")} />
            <rect x={266} y={2} width={40} height={12} rx={6} style={on("rt")} />
            <rect x={84} y={20} width={60} height={12} rx={6} style={on("lb")} />
            <rect x={256} y={20} width={60} height={12} rx={6} style={on("rb")} />
        </>
    );
}

/** The DualSense: touchpad up top, symmetric low sticks, create/options slits. */
function DualSense({ on, sticks }: { on: On; sticks: Sticks }) {
    return (
        <>
            <path d="M 124 42 C 156 34 244 34 276 42 C 308 48 326 56 338 74 C 358 102 372 148 366 182 C 362 210 346 228 326 226 C 306 224 298 202 284 186 C 270 170 240 162 200 162 C 160 162 130 170 116 186 C 102 202 94 224 74 226 C 54 228 38 210 34 182 C 28 148 42 102 62 74 C 74 56 92 48 124 42 Z" />
            {/* Touchpad, with the create / options slits beside it. */}
            <rect x={152} y={50} width={96} height={52} rx={15} className="pad-well" />
            <rect x={138} y={54} width={7} height={18} rx={3.5} style={on("select")} />
            <rect x={255} y={54} width={7} height={18} rx={3.5} style={on("start")} />
            <Dpad cx={97} cy={112} on={on} />
            <FaceButtons cx={303} cy={112} on={on} />
            <Stick cx={158} cy={146} on={on} button="l3" nub={12} sticks={sticks} slot={0} />
            <Stick cx={242} cy={146} on={on} button="r3" nub={12} sticks={sticks} slot={1} />
            {/* The PS button and the mic slit between the sticks. */}
            <circle cx={200} cy={128} r={7} />
            <rect x={188} y={146} width={24} height={4} rx={2} className="pad-dead" />
            <Shoulders on={on} />
        </>
    );
}

/** The Xbox layout: left stick high, d-pad low center-left, guide up top. */
function XboxPad({ on, sticks }: { on: On; sticks: Sticks }) {
    return (
        <>
            <path d="M 128 44 C 158 34 242 34 272 44 C 304 52 322 60 334 78 C 354 108 368 150 362 184 C 358 212 342 230 322 228 C 302 226 294 204 280 188 C 266 172 238 166 200 166 C 162 166 134 172 120 188 C 106 204 98 226 78 228 C 58 230 42 212 38 184 C 32 150 46 108 66 78 C 78 60 96 52 128 44 Z" />
            {/* Guide, view and menu. */}
            <circle cx={200} cy={66} r={13} className="pad-well" />
            <rect x={168} y={94} width={13} height={13} rx={6.5} style={on("select")} />
            <rect x={219} y={94} width={13} height={13} rx={6.5} style={on("start")} />
            <Stick cx={116} cy={100} on={on} button="l3" nub={13} sticks={sticks} slot={0} />
            <FaceButtons cx={284} cy={100} on={on} />
            <Dpad cx={160} cy={154} on={on} arm={16} len={18} />
            <Stick cx={240} cy={154} on={on} button="r3" nub={12} sticks={sticks} slot={1} />
            <Shoulders on={on} />
        </>
    );
}

const LIVE = "var(--accent-color)";

export function ControllerPanel() {
    const pad = usePad();
    const [held, setHeld] = useState("");
    const sticks = useRef<(SVGGElement | null)[]>([]);

    useEffect(
        () =>
            observePad((snap) => {
                const names = heldPadButtons(snap).join(",");
                setHeld((prev) => (prev === names ? prev : names));
                // The stick nubs track the real sticks, outside React.
                sticks.current[0]?.setAttribute(
                    "transform",
                    `translate(${(snap.axes[0] ?? 0) * 5} ${(snap.axes[1] ?? 0) * 5})`,
                );
                sticks.current[1]?.setAttribute(
                    "transform",
                    `translate(${(snap.axes[2] ?? 0) * 5} ${(snap.axes[3] ?? 0) * 5})`,
                );
            }),
        [],
    );

    const live = new Set(held.split(","));
    const on: On = (b) => (live.has(b) ? { fill: LIVE, stroke: LIVE } : undefined);

    return (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-6">
            <svg
                className="pad-svg"
                viewBox="0 0 400 240"
                role="img"
                aria-label={
                    pad === "ps" ? "PlayStation controller diagram" : "Xbox controller diagram"
                }
                data-connected={pad ? "" : undefined}
            >
                {pad === "ps" ? (
                    <DualSense on={on} sticks={sticks} />
                ) : (
                    <XboxPad on={on} sticks={sticks} />
                )}
            </svg>
            <SettingList rows={rows(pad)} />
        </div>
    );
}

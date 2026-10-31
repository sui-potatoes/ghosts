// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useEffect, useRef, useState } from "react";

import {
    heldPadButtons,
    observePad,
    onPad,
    padGlyph,
    padName,
    type PadButton,
} from "@ghosts/engine/gamepad";

import { usePad } from "../components/PadHints";
import { onAction } from "../input";
import diagram from "./controller-diagram.svg?raw";
import { useLayoutMode } from "./layoutMode";
import { SettingList, type SettingRow } from "./SettingList";
import { DEFAULTS, LAYOUTS, useSettingsSection, type LayoutChoice } from "./store";
import "./controller.css";

/**
 * The controller category: the hand-drawn pad diagram (cleaned from the
 * repo-root controller.svg by scripts/controller-svg/clean.ts), where every
 * control carries its field action on the artist's leader lines, pressed
 * buttons light up and the stick caps follow the real sticks — over the
 * fixed bindings for the menus and the field. Nothing to configure yet;
 * this page is the reference the hints bars abbreviate.
 */

const g = (...buttons: (PadButton | "dpad" | "ls" | "rs")[]) => buttons.map(padGlyph).join("  ");

const LAYOUT_LABELS: Record<LayoutChoice, string> = {
    auto: "Auto",
    desktop: "Desktop",
    controller: "Controller",
};

function rows(pad: string, layout: SettingRow, test: SettingRow): SettingRow[] {
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
        layout,
        test,
        { kind: "section", id: "menus", label: "Menus" },
        stat("m-nav", "Navigate", g("dpad", "ls"), "Walk menu entries and setting rows."),
        stat("m-change", "Change value", "◀  ▶", "Cycle a choice or step a slider."),
        stat("m-select", "Select", g("a"), "Activate the focused entry."),
        stat("m-back", "Back", g("b", "start"), "Close the dialog, or leave the screen."),
        stat("m-cat", "Category", g("lb", "rb"), "Previous or next settings category."),
        stat(
            "m-section",
            "Section",
            g("lt", "rt"),
            "Jump to the previous or next section of a list.",
        ),
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

// ---------------------------------------------------------------------------
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

/** The field action each control performs, on its label row. The physical
 *  button is named only where the art does not name it itself. */
const ACTIONS: Record<string, [prefix: PadButton | "ls" | "rs" | "", action: string]> = {
    "ctl-rt": ["rt", "Fire"],
    "ctl-rb": ["rb", "Next operator"],
    "ctl-lt": ["lt", "Grenade"],
    "ctl-lb": ["lb", "Prev operator"],
    "ctl-y": ["", "Action wheel"],
    "ctl-b": ["", "Cancel / pause"],
    "ctl-a": ["", "Confirm"],
    "ctl-x": ["", "Reload"],
    "ctl-start": ["", "Pause"],
    "ctl-select": ["", "Tactical grid"],
    "ctl-stick-left": ["ls", "Cursor / aim"],
    "ctl-stick-right": ["rs", "Camera"],
    "ctl-up": ["", "Cursor up"],
    "ctl-down": ["", "Cursor down"],
    "ctl-left": ["", "Cursor left"],
    "ctl-right": ["", "Cursor right"],
};

/** The engine button a diagram group stands for, for live highlighting. */
function padOf(id: string): PadButton {
    if (id === "ctl-stick-left") return "l3";
    if (id === "ctl-stick-right") return "r3";
    return id.slice(4) as PadButton;
}

// ---------------------------------------------------------------------------
// Button test mode: a top-priority pad consumer plus an action swallow keep
// every input on this panel — the diagram still lights up (observePad is not
// consumed) and the line below names what is held. Exit: hold start for two
// seconds (a per-frame fill shows the progress), press Escape, or click.

const HOLD_EXIT_MS = 2000;
const STICK_MOVED = 0.5;

/** The field action of each control, reusing the diagram's label data. */
const FIELD_ACTIONS = new Map(Object.entries(ACTIONS).map(([id, [, a]]) => [padOf(id), a]));

/** "R2 — Fire": the control's face on this pad family and its field action. */
function testLabel(control: PadButton | "ls" | "rs"): string {
    const button = control === "ls" ? "l3" : control === "rs" ? "r3" : control;
    const action = FIELD_ACTIONS.get(button);
    return action ? `${padGlyph(control)} — ${action}` : padGlyph(control);
}

// The label layer extends the art's 100×100 box; size the viewBox so the
// longest row on each side fits (mono advance ≈ 0.68em at the label size).
const FONT = 2.6;
const CHAR = FONT * 0.68;
const GAP = 1.5;
const PREFIX = 5; // "R2 · ", every prefix is two characters

const VIEW_BOX = (() => {
    let minX = 0;
    let maxX = 100;
    for (const { id, x, align } of ANCHORS) {
        const spec = ACTIONS[id];
        if (!spec) continue;
        const width = ((spec[0] ? PREFIX : 0) + spec[1].length) * CHAR + GAP;
        if (align === "start") maxX = Math.max(maxX, x + width);
        if (align === "end") minX = Math.min(minX, x - width);
    }
    return `${(minX - 2).toFixed(1)} 10 ${(maxX - minX + 4).toFixed(1)} 84`;
})();

const STICK_TRAVEL = 1.8; // in art units; the cap wells are ~4 wide

export function ControllerPanel() {
    const pad = usePad();
    const root = useRef<SVGSVGElement | null>(null);
    const [controls, setControls] = useSettingsSection("controls");
    // The side-by-side split needs the controller layout's full-width page;
    // inside the desktop layout's capped column the panel stays a stack.
    const side = useLayoutMode() === "controller";
    const [testing, setTesting] = useState(false);
    const [held, setHeld] = useState<string[]>([]);
    const holdFill = useRef<HTMLSpanElement | null>(null);

    // Any explicit choice also answers the "controller connected" prompt.
    const setLayout = (layout: LayoutChoice) => setControls({ layout, layoutAnswered: true });
    const stepLayout = (dir: 1 | -1) =>
        setLayout(
            LAYOUTS[(LAYOUTS.indexOf(controls.layout) + dir + LAYOUTS.length) % LAYOUTS.length],
        );

    // A disconnect mid-test leaves nothing to test; hand the panel back.
    useEffect(() => {
        if (!pad) setTesting(false);
    }, [pad]);

    // The swallows, registered on entry so LIFO puts them above the list's
    // and the view's handlers: the pad consumer outranks the menu handler
    // (priority 50 over 0) and eats every frame; the action handler eats the
    // keyboard's menu actions, except that back (Escape) exits the test.
    useEffect(() => {
        if (!testing) return;
        const unbindPad = onPad(() => true, 50);
        const unbindActions = onAction((action) => {
            if (action === "back") setTesting(false);
            return true;
        });
        return () => {
            unbindPad();
            unbindActions();
        };
    }, [testing]);

    // The readout and the hold-to-exit timer, off the raw snapshots. The
    // fill width is written per frame outside React — deliberately not a CSS
    // animation, so reduce-motion still shows the progress.
    useEffect(() => {
        if (!testing) return;
        setHeld([]);
        let holdFrom = 0;
        let prevKey = "";
        return observePad((snap) => {
            const active: (PadButton | "ls" | "rs")[] = heldPadButtons(snap);
            if (Math.hypot(snap.axes[0] ?? 0, snap.axes[1] ?? 0) > STICK_MOVED) active.push("ls");
            if (Math.hypot(snap.axes[2] ?? 0, snap.axes[3] ?? 0) > STICK_MOVED) active.push("rs");
            const key = active.join(" ");
            if (key !== prevKey) {
                prevKey = key;
                setHeld(active.map(testLabel));
            }
            if (active.includes("start")) {
                const now = performance.now();
                if (!holdFrom) holdFrom = now;
                const t = Math.min(1, (now - holdFrom) / HOLD_EXIT_MS);
                if (holdFill.current) holdFill.current.style.width = `${t * 100}%`;
                if (t >= 1) setTesting(false);
            } else {
                holdFrom = 0;
                if (holdFill.current) holdFill.current.style.width = "0%";
            }
        });
    }, [testing]);

    const layoutRow: SettingRow = {
        kind: "choice",
        id: "layout",
        label: "Settings layout",
        description:
            "How Settings lays itself out. Auto uses the controller layout while a pad is connected and the desktop layout otherwise.",
        value: LAYOUT_LABELS[controls.layout],
        onPrev: () => stepLayout(-1),
        onNext: () => stepLayout(1),
        onReset: () => setLayout(DEFAULTS.controls.layout),
    };

    const testRow: SettingRow = {
        kind: "action",
        id: "test",
        label: "Test buttons",
        value: pad ? "" : <span className="set-note">no controller</span>,
        disabled: !pad,
        description: pad
            ? "Try every control: presses light the diagram and are named under it. Input stays on this panel until you exit."
            : "Connect a controller to test its buttons.",
        onConfirm: () => setTesting(true),
    };

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
        // Controller layout on a wide screen: the binding rows at a fixed
        // readable width on the left, the diagram filling the remainder.
        // Everywhere else (desktop layout, narrow screens): the stack,
        // diagram first.
        <div
            className={`flex min-h-0 min-w-0 flex-1 flex-col gap-6 ${
                side ? "xl:flex-row xl:items-stretch xl:gap-12" : ""
            }`}
            data-side={side || undefined}
        >
            <div
                className={`flex min-w-0 flex-none flex-col justify-center gap-6 ${
                    side ? "xl:order-2 xl:flex-1" : ""
                }`}
            >
                <svg
                    ref={root}
                    className="ctl-svg"
                    viewBox={VIEW_BOX}
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
                            const spec = ACTIONS[id];
                            if (!spec) return null;
                            const [prefix, action] = spec;
                            const tx = align === "start" ? x + GAP : align === "end" ? x - GAP : x;
                            return (
                                <text key={id} x={tx} y={y} textAnchor={align} data-pad={padOf(id)}>
                                    {prefix ? (
                                        <tspan className="ctl-glyph">{`${padGlyph(prefix)} · `}</tspan>
                                    ) : null}
                                    {action}
                                </text>
                            );
                        })}
                    </g>
                </svg>
                {testing ? (
                    <div className="ctl-test">
                        <div
                            className="ctl-test-line"
                            data-idle={held.length === 0 || undefined}
                            aria-live="polite"
                        >
                            {held.length ? held.join("  ·  ") : "Press any control."}
                        </div>
                        <div className="ctl-test-exit">
                            <span className="ctl-test-hold" aria-hidden>
                                <span ref={holdFill} className="ctl-test-hold-fill" />
                                <span className="ctl-test-hold-text">
                                    Hold {padGlyph("start")} 2 s to exit
                                </span>
                            </span>
                            <button
                                type="button"
                                className="ctl-test-close"
                                onClick={() => setTesting(false)}
                            >
                                Exit test
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="label ctl-caption" aria-hidden>
                        Field actions on the diagram — menu bindings in the list.
                    </div>
                )}
            </div>
            <div
                className={`ctl-rows flex min-h-0 min-w-0 flex-1 flex-col ${
                    side ? "xl:order-1 xl:w-[440px] xl:flex-none" : ""
                }`}
                data-testing={testing || undefined}
            >
                <SettingList rows={rows(pad, layoutRow, testRow)} />
            </div>
        </div>
    );
}

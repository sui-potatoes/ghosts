// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useEffect, useMemo, useRef, useState } from "react";

import {
    heldPadButtons,
    observePad,
    onPad,
    padGlyph,
    padName,
    type PadButton,
} from "@ghosts/engine/gamepad";
import {
    DEFAULT_PAD_COMBAT_BINDINGS,
    PAD_BINDABLE,
    PAD_COMBAT_ACTIONS,
    PAD_COMBAT_LABELS,
    type PadBindable,
    type PadCombatAction,
} from "@ghosts/engine/keys";

import { usePad } from "../components/PadHints";
import { onAction } from "../input";
import { ControllerDiagram, fieldActions } from "./ControllerDiagram";
import { useLayoutMode, useLayoutRow } from "./layoutMode";
import { SettingList, type SettingRow } from "./SettingList";
import { useSettingsSection } from "./store";
import "./controller.css";

/**
 * The controller category: the hand-drawn pad diagram (cleaned from the
 * repo-root controller.svg by scripts/controller-svg/clean.ts), where every
 * control carries its field action on the artist's leader lines, pressed
 * buttons light up and the stick caps follow the real sticks — over the
 * bindings for the menus and the field. The combat rows with a bindable
 * action rebind on Confirm: the next pressed button takes the action (B
 * cancels), a button already in use swaps over, and the diagram's labels
 * follow the record.
 */

const g = (...buttons: (PadButton | "dpad" | "ls" | "rs")[]) => buttons.map(padGlyph).join("  ");

const stat = (id: string, label: string, value: string, description: string): SettingRow => ({
    kind: "static",
    id,
    label,
    description,
    value,
});

// ---------------------------------------------------------------------------
// Button test mode: a top-priority pad consumer plus an action swallow keep
// every input on this panel — the diagram still lights up (observePad is not
// consumed) and the line below names what is held. Exit: hold start for two
// seconds (a per-frame fill shows the progress), press Escape, or click.

const HOLD_EXIT_MS = 2000;
const STICK_MOVED = 0.5;

export function ControllerPanel() {
    const pad = usePad();
    const [controls, setControls] = useSettingsSection("controls");
    const binds = controls.padCombat;
    // The side-by-side split needs the controller layout's full-width page;
    // inside the desktop layout's capped column the panel stays a stack.
    const side = useLayoutMode() === "controller";
    const [testing, setTesting] = useState(false);
    /** The pad combat action whose next button a capture is listening for. */
    const [capturing, setCapturing] = useState<PadCombatAction | null>(null);
    const [held, setHeld] = useState<string[]>([]);
    const holdFill = useRef<HTMLSpanElement | null>(null);
    const layoutRow = useLayoutRow();

    const fields = useMemo(() => fieldActions(binds), [binds]);
    const fieldsRef = useRef(fields);
    fieldsRef.current = fields;

    /** "R2 — Fire": the control's face on this pad family and its field action. */
    const testLabel = (control: PadButton | "ls" | "rs"): string => {
        // Stick deflection is always the cursor or the camera; the clicks
        // (L3/R3) answer for themselves through the bindings.
        if (control === "ls") return `${padGlyph("ls")} — Cursor / aim`;
        if (control === "rs") return `${padGlyph("rs")} — Camera`;
        const action = fieldsRef.current.get(control);
        return action ? `${padGlyph(control)} — ${action}` : padGlyph(control);
    };

    // A disconnect mid-test or mid-capture leaves nothing to listen to; hand
    // the panel back.
    useEffect(() => {
        if (!pad) {
            setTesting(false);
            setCapturing(null);
        }
    }, [pad]);

    // Hand `button` to `action`; an action already holding it takes this
    // action's old button instead — a swap, so no button serves two orders.
    const assign = (action: PadCombatAction, button: PadBindable | "") => {
        const next = { ...binds };
        const prev = next[action];
        if (button) {
            for (const other of PAD_COMBAT_ACTIONS) {
                if (other !== action && next[other] === button) next[other] = prev;
            }
        }
        next[action] = button;
        setControls({ padCombat: next });
    };
    const assignRef = useRef(assign);
    assignRef.current = assign;

    // Rebind capture: a top-priority pad consumer takes the next bindable
    // button — B cancels, the fixed buttons are spent unheard — while a bus
    // swallow keeps the keyboard's menu actions off the list behind it
    // (Escape still cancels through "back").
    useEffect(() => {
        if (!capturing) return;
        const unbindPad = onPad((p) => {
            if (p.pressed("b")) {
                setCapturing(null);
                return true;
            }
            for (const b of PAD_BINDABLE) {
                if (p.pressed(b)) {
                    assignRef.current(capturing, b);
                    setCapturing(null);
                    return true;
                }
            }
            return true;
        }, 50);
        const unbindActions = onAction((action) => {
            if (action === "back") setCapturing(null);
            return true;
        });
        return () => {
            unbindPad();
            unbindActions();
        };
    }, [capturing]);

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
        // testLabel reads the live bindings through a ref, so the readout
        // needs no resubscribe on a rebind (rebinding mid-test is fenced off
        // anyway).
    }, [testing]);

    const testRow: SettingRow = {
        kind: "action",
        id: "test",
        label: "Test buttons",
        value: pad ? "" : <span className="set-note">no controller</span>,
        disabled: !pad,
        description: pad
            ? "Try every control: presses light the diagram and are named under it. Input stays on this panel until you exit."
            : "Connect a controller to test its buttons.",
        onConfirm: () => {
            setCapturing(null);
            setTesting(true);
        },
    };

    /** A rebindable combat row: Confirm captures the next pressed button. */
    const bindRow = (action: PadCombatAction, what: string): SettingRow => ({
        kind: "action",
        id: `bind-${action}`,
        label: PAD_COMBAT_LABELS[action],
        value:
            capturing === action ? (
                <span className="set-capture">press a control</span>
            ) : binds[action] ? (
                padGlyph(binds[action] as PadBindable)
            ) : (
                <span className="set-note">unbound</span>
            ),
        disabled: !pad,
        description: pad
            ? `${what} Confirm, then press the new control — a button in use swaps over; ${padGlyph("b")} cancels.`
            : `${what} Connect a controller to rebind.`,
        onConfirm: () => {
            setTesting(false);
            setCapturing(action);
        },
        onReset: () => assign(action, DEFAULT_PAD_COMBAT_BINDINGS[action]),
    });

    const rows: SettingRow[] = [
        stat(
            "status",
            "Device",
            pad ? padName() || "Controller" : "Not connected",
            pad
                ? "Standard-mapped controller. Press buttons to see them on the diagram."
                : "Connect a controller and press any button to wake it.",
        ),
        layoutRow,
        testRow,
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
            "Move the tile cursor, nudge the throw, or walk targets; with nobody selected, pan the camera. Fixed.",
        ),
        stat(
            "c-confirm",
            "Confirm",
            g("a"),
            "Move to the cursor, take the shot, throw the grenade; with nobody selected, take the operator nearest the camera. Fixed.",
        ),
        stat(
            "c-cancel",
            "Cancel / deselect",
            g("b"),
            "Leave targeting, then deselect the operator; with nobody selected, pause. Fixed.",
        ),
        bindRow("wheel", "Orders on a ring: fire, grenade, overwatch, hunker, reload, extract."),
        bindRow("prev-operator", "Select the previous operator."),
        bindRow("next-operator", "Select the next operator."),
        bindRow("fire", "Raise the weapon at the best target."),
        bindRow("grenade", "Arm a grenade at the default landing point."),
        bindRow("reload", "Fresh magazine for the selected operator."),
        bindRow("grid", "Toggle the grid overlay."),
        bindRow("focus", "Center the camera on the selected operator, at belt height."),
        stat(
            "c-camera",
            "Camera",
            g("rs"),
            "Turn the field and dolly in and out with the right stick; with nobody selected it tilts, and the triggers zoom. Fixed.",
        ),
        stat("c-pause", "Pause", g("start"), "The pause menu, any time. Fixed."),
        {
            kind: "action",
            id: "bind-reset",
            label: "Reset combat bindings",
            value: "",
            description: "Return every pad combat binding to its default.",
            onConfirm: () => setControls({ padCombat: DEFAULT_PAD_COMBAT_BINDINGS }),
        },
    ];

    return (
        // Controller layout on a wide screen: the binding rows at a fixed
        // readable width on the left, the diagram filling the remainder.
        // Everywhere else (desktop layout, narrow screens): the stack,
        // diagram first.
        <div
            className={`ctl-panel flex min-h-0 min-w-0 flex-1 flex-col gap-6 ${
                side ? "xl:flex-row xl:items-stretch xl:gap-12" : ""
            }`}
            data-side={side || undefined}
        >
            <div
                className={`flex min-w-0 flex-none flex-col justify-center gap-6 ${
                    side ? "xl:order-2 xl:flex-1" : ""
                }`}
            >
                <ControllerDiagram binds={binds} pad={pad} />
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
                <SettingList rows={rows} />
            </div>
        </div>
    );
}

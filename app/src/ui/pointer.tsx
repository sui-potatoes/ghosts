// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The mouse's own reach to a target's commands: the armed target's confirm
 * button on its row (the second click, named), and a right-click list of every
 * command at the pointer. Both run the same commands as the bar and the pad;
 * the keyboard never sees them. Hover alone never adds anything to a row.
 */

import type { MouseEvent, RefObject } from "react";

import { FocusScope, useFocusable, useFocusState, type Command } from "./focus";
import { Glyph, useGlyphSet, type GlyphSet } from "./glyphs";

const ORDER = ["confirm", "reset"] as const;

/** The commands a mouse can run from the target itself: primary first, then the rest. */
function reachable(commands: Command[]): Command[] {
    return ORDER.map((action) => commands.find((c) => c.action === action)).filter(
        (c): c is Command => !!c,
    );
}

/**
 * The confirm button of a target waiting for its second click (or offered as a
 * two-step action), at the row's trailing edge. Only the row's own primary:
 * secondary and list-wide commands are never inline, so nothing appears on a
 * row because the pointer is over it. The CSS keeps it from changing the
 * row's height.
 */
export function InlineCommands({
    armed,
}: {
    /** The primary of an armed target: a labelled button that runs it (the second click). */
    armed?: Command;
}) {
    const store = useFocusState();
    const glyphs = useGlyphSet();
    if (!armed) return null;
    return (
        <span className="gui-inline">
            <button
                type="button"
                tabIndex={-1}
                className="gui-chip-cmd"
                data-tone={armed.tone === "danger" ? "danger" : "primary"}
                data-confirm=""
                onMouseDown={(e: MouseEvent) => e.preventDefault()}
                onClick={(e: MouseEvent) => {
                    e.stopPropagation();
                    if (store.armed !== null) store.confirmArmed();
                    else store.run(armed);
                }}
            >
                <Glyph action="confirm" set={glyphs} />
                {armed.label}
            </button>
        </span>
    );
}

/**
 * The right-click list, in the prompt's language (a framed block with a top
 * rule and command lines). It is a focus scope, so the keys work in it too
 * and Back closes it; a click outside closes it.
 */
export function ContextMenu({ root }: { root: RefObject<HTMLElement | null> }) {
    const store = useFocusState();
    const glyphs = useGlyphSet();
    const menu = store.menu;
    const node = store.node(menu?.id ?? null);
    const host = root.current;
    if (!menu || !node || !host) return null;
    const list = reachable(node.commands);
    if (!list.length) return null;
    const box = host.getBoundingClientRect();
    const scale = box.width / host.offsetWidth || 1;
    // Keep the list inside the screen: flip left or up near the edges.
    const x = (menu.x - box.left) / scale;
    const y = (menu.y - box.top) / scale;
    const width = 220;
    const height = 12 + list.length * 40;
    const left = x + width > host.offsetWidth - 8 ? x - width : x;
    const top = y + height > host.offsetHeight - 8 ? y - height : y;
    const close: Command = { action: "back", label: "Close", run: () => store.closeMenu() };
    return (
        <FocusScope id="menu" back={close}>
            <div
                className="gui-menu-catch"
                onPointerDown={() => store.closeMenu()}
                onContextMenu={(e) => {
                    e.preventDefault();
                    store.closeMenu();
                }}
            />
            <div className="gui-menu" role="menu" style={{ left, top, minWidth: width }}>
                <span className="gui-menu-title">{node.title}</span>
                {list.map((command) => (
                    <MenuItem key={command.action} command={command} glyphs={glyphs} />
                ))}
            </div>
        </FocusScope>
    );
}

function MenuItem({ command, glyphs }: { command: Command; glyphs: GlyphSet }) {
    const store = useFocusState();
    const run = () => {
        store.closeMenu();
        store.run(command);
    };
    const { props } = useFocusable<HTMLButtonElement>({
        id: `menu-${command.action}`,
        group: "menu",
        title: command.label,
        hint: command.deny,
        commands: [{ ...command, run }],
    });
    return (
        <button
            type="button"
            tabIndex={-1}
            role="menuitem"
            className="gui-menu-item"
            data-tone={command.tone}
            {...props}
            onClick={(e) => {
                e.stopPropagation();
                if (command.deny) store.run(command);
                else run();
            }}
        >
            <Glyph action={command.action} set={glyphs} />
            <span>{command.label}</span>
        </button>
    );
}

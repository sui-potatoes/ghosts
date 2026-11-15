// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The mouse's own reach to a target's commands, so nothing needs a trip to
 * the command bar across rows: the selected row carries its secondary
 * commands inline at its trailing edge (the primary is the click itself), and
 * a right-click lists them all at the pointer when there is a secondary. Both
 * run the same commands as the bar and the pad; the keyboard never sees them.
 */

import type { MouseEvent, RefObject } from "react";

import { FocusScope, secondaryCommands, useFocusable, useFocusState, type Command } from "./focus";
import { Glyph, useGlyphSet, type GlyphSet } from "./glyphs";

const ORDER = ["confirm", "reset"] as const;

/** The commands a mouse can run from the target itself: primary first, then the rest. */
function reachable(commands: Command[]): Command[] {
    return ORDER.map((action) => commands.find((c) => c.action === action)).filter(
        (c): c is Command => !!c,
    );
}

/** Small glyph + label chips at a selected row's trailing edge: its secondary commands. */
export function InlineCommands({
    commands,
    armed,
}: {
    commands: Command[];
    /** The primary of an armed target: a labelled button that runs it (the second click). */
    armed?: Command;
}) {
    const store = useFocusState();
    const glyphs = useGlyphSet();
    const list = secondaryCommands(commands);
    if (!list.length && !armed) return null;
    return (
        <span className="gui-inline">
            {armed && (
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
            )}
            {list.map((command) => (
                <button
                    key={command.action}
                    type="button"
                    tabIndex={-1}
                    className="gui-chip-cmd"
                    data-tone={command.tone}
                    data-denied={command.deny ? "" : undefined}
                    aria-disabled={command.deny ? true : undefined}
                    onMouseDown={(e: MouseEvent) => e.preventDefault()}
                    onClick={(e: MouseEvent) => {
                        e.stopPropagation();
                        store.run(command);
                    }}
                >
                    <Glyph action={command.action} set={glyphs} />
                    {command.short ?? command.label}
                </button>
            ))}
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

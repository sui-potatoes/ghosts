// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * What the settings panels share with the view that mounts them: the context
 * (`useSettingsContext`) and the frame every panel draws itself in. Its own
 * module, so the panels and the view do not import each other: a cycle there let
 * a hot reload pair a panel with a stale context and throw.
 */

import { createContext, useContext, useRef, type ReactNode } from "react";

import {
    barOf,
    CommandBar,
    ScreenFrame,
    StatusChip,
    Tabs,
    useFocusState,
    type GlyphSet,
} from "../../ui";
import type { AccountBits } from "./account";
import { tabsFor, type TabId } from "./model";
import type { RpcDraft } from "./rpc";

/** What every panel needs from the view: the frame's shared bits. */
export type SettingsContext = {
    tab: TabId;
    select: (tab: TabId) => void;
    glyphs: GlyphSet;
    location: string[];
    onLocation: () => void;
    account: AccountBits;
    rpc: RpcDraft;
    /** The view's own prompt (leaving with an unsaved endpoint), over any panel's. */
    prompt: ReactNode;
    /** Mounted over a match (the pause menu's Options): nothing that changes the player. */
    inMatch: boolean;
};

const Context = createContext<SettingsContext | null>(null);

export function useSettingsContext(): SettingsContext {
    const ctx = useContext(Context);
    if (!ctx) throw new Error("useSettingsContext outside <SettingsView>");
    return ctx;
}

/** The view's provider of the context. */
export const SettingsProvider = Context.Provider;

/**
 * The one body grid of every category, so switching tabs never resizes a panel:
 * the first panel is the first track, a second panel (or the controller's
 * diagram) the second, the rest is spare.
 */
const COLUMNS = "minmax(0, 520px) minmax(0, 560px) minmax(0, 1fr)";

export type Line = { text: string; tone: "ok" | "warn" } | null;

/**
 * The frame every panel draws itself in: the breadcrumb, the categories as
 * tabs, the panel's status chips, its body columns, a prompt as the overlay
 * and the command bar with the panel's line (a probe result, a refused
 * write) on the hint slot — amber when it is a failure.
 */
export function SettingsFrame({
    status,
    overlay,
    line,
    children,
}: {
    status?: ReactNode;
    overlay?: ReactNode;
    line?: Line;
    children: ReactNode;
}) {
    const ctx = useSettingsContext();
    return (
        <ScreenFrame
            location={ctx.location}
            onLocation={ctx.onLocation}
            tabs={
                <Tabs
                    tabs={tabsFor(ctx.glyphs === "none").map((t) => ({ id: t.id, label: t.label }))}
                    active={ctx.tab}
                    onSelect={(id) => ctx.select(id as TabId)}
                    glyphs={ctx.glyphs}
                />
            }
            status={
                <>
                    <i className="gset-frame" aria-hidden />
                    {status}
                    {ctx.tab !== "network" && ctx.rpc.view.unsaved && (
                        <StatusChip label="Endpoint" value="Unsaved" tone="warn" />
                    )}
                </>
            }
            columns={COLUMNS}
            commands={<SettingsCommandBar glyphs={ctx.glyphs} line={line ?? null} />}
            overlay={ctx.prompt || overlay}
        >
            {children}
        </ScreenFrame>
    );
}

/** The command bar with the panel's line: ok in the hint slot, a failure on the amber line. */
function SettingsCommandBar({ glyphs, line }: { glyphs: GlyphSet; line: Line }) {
    const store = useFocusState();
    const { title, hint, commands, target } = barOf(store);
    const confirm = commands.find((c) => c.action === "confirm");
    const warn = line?.tone === "warn" ? line.text : undefined;
    const pulse = store.pulse;
    // A new failure replays the refusal flash.
    const flashes = useRef(0);
    const last = useRef<string | undefined>(undefined);
    if (warn !== last.current) {
        last.current = warn;
        if (warn) flashes.current++;
    }
    return (
        <CommandBar
            title={title}
            hint={line?.tone === "ok" ? line.text : hint}
            deny={confirm?.deny ?? warn}
            denyKey={store.denies + flashes.current}
            commands={commands.filter((c) => c.action !== "back")}
            back={store.command("back")!}
            glyphs={glyphs}
            pressed={pulse?.kind === "press" ? pulse.action : null}
            onRun={(command) => store.run(command, target)}
        />
    );
}

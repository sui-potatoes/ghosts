// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Settings in the shared interface language: one `FocusRoot` + `ScreenFrame`,
 * the categories as the header's tabs (bumpers / Q·E), each category a panel
 * of focusable rows bound to the same store keys as the classic screen. The
 * route (`src/screens/Settings.tsx`) and the pause menu's Options both mount
 * this view; only the way out differs.
 */

import { createContext, useContext, useRef, useState, type ReactNode } from "react";

import { uiTick } from "../../audio";
import {
    barOf,
    CommandBar,
    FocusRoot,
    Prompt,
    ScreenFrame,
    StatusChip,
    Tabs,
    useFocusState,
    useGlyphSet,
    type GlyphSet,
} from "../../ui";
import { useAccountBits, type AccountBits } from "./account";
import { useRatingQaSeed } from "./rating-qa";
import { stepTab, TABS, type TabId } from "./model";
import {
    AccountPanel,
    AudioPanel,
    ControllerPanel,
    ControlsPanel,
    DisplayPanel,
    NetworkPanel,
    PlayerPanel,
} from "./panels";
import { useRpcDraft, type RpcDraft } from "./rpc";
import "./settings-gui.css";

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

const PANELS: Record<TabId, () => ReactNode> = {
    player: PlayerPanel,
    account: AccountPanel,
    audio: AudioPanel,
    display: DisplayPanel,
    controls: ControlsPanel,
    controller: ControllerPanel,
    network: NetworkPanel,
};

export function SettingsView({
    tab,
    onTab,
    location,
    backLabel,
    onBack,
    account: fixture,
    inMatch = false,
}: {
    tab: TabId;
    onTab: (tab: TabId) => void;
    /** The breadcrumb: `["System", "Settings"]`, or the pause menu's. */
    location: string[];
    /** What Back is called here: `Leave`, `Paused`. */
    backLabel: string;
    onBack: () => void;
    /** Account data for a fixture harness; the live account otherwise. */
    account?: AccountBits;
    inMatch?: boolean;
}) {
    useRatingQaSeed();
    const glyphs = useGlyphSet();
    const live = useAccountBits();
    const account = fixture ?? live;
    const rpc = useRpcDraft();
    const [leaving, setLeaving] = useState<(() => void) | null>(null);

    // A typed endpoint that was never saved asks before it is lost.
    const guard = (go: () => void) => {
        if (rpc.view.unsaved) setLeaving(() => go);
        else go();
    };
    const select = (next: TabId) => {
        if (next === tab) return;
        uiTick(null);
        onTab(next);
    };
    const leave = () => guard(onBack);

    const prompt = leaving && (
        <Prompt
            id="prompt-unsaved-endpoint"
            eyebrow="Unsaved endpoint"
            title="Save the endpoint?"
            hint="Discard keeps the endpoint as it was"
            confirm={{
                label: "Save",
                deny: rpc.view.saveDeny,
                run: () => {
                    void rpc.save().then((ok) => {
                        if (!ok) return;
                        setLeaving(null);
                        leaving();
                    });
                },
            }}
            alternate={{
                label: "Discard",
                run: () => {
                    rpc.discard();
                    setLeaving(null);
                    leaving();
                },
            }}
            cancel={{ label: "Keep editing", run: () => setLeaving(null) }}
            glyphs={glyphs}
        >
            The typed endpoint is lost unless it is saved.
        </Prompt>
    );

    const ctx: SettingsContext = {
        tab,
        select,
        glyphs,
        location,
        onLocation: leave,
        account,
        rpc,
        prompt,
        inMatch,
    };
    const Panel = PANELS[tab];

    return (
        <FocusRoot
            back={{ action: "back", label: backLabel, run: leave }}
            onTab={(step) => select(stepTab(tab, step))}
        >
            <Context.Provider value={ctx}>
                <Panel />
            </Context.Provider>
        </FocusRoot>
    );
}

export type Line = { text: string; tone: "ok" | "warn" } | null;

/**
 * The frame every panel draws itself in: the breadcrumb, the categories as
 * tabs, the panel's status chips, its body columns, a prompt as the overlay
 * and the command bar with the panel's line (a probe result, a refused
 * write) on the hint slot — amber when it is a failure.
 */
export function SettingsFrame({
    columns,
    status,
    overlay,
    line,
    children,
}: {
    columns: string;
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
                    tabs={TABS.map((t) => ({ id: t.id, label: t.label }))}
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
            columns={columns}
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

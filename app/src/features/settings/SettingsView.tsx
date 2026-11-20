// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Settings in the shared interface language: one `FocusRoot` + `ScreenFrame`,
 * the categories as the header's tabs (bumpers / Q·E), each category a panel
 * of focusable rows bound to the same store keys as the classic screen. The
 * route (`src/screens/Settings.tsx`) and the pause menu's Options both mount
 * this view; only the way out differs.
 */

import { useState, type ReactNode } from "react";

import { uiTick } from "../../audio";
import { FocusRoot, Prompt, useGlyphSet } from "../../ui";
import { useAccountBits, type AccountBits } from "./account";
import { stepTab, type TabId } from "./model";
import {
    AccountPanel,
    AudioPanel,
    ControllerPanel,
    ControlsPanel,
    DisplayPanel,
    NetworkPanel,
    PlayerPanel,
} from "./panels";
import { SettingsProvider, type SettingsContext } from "./frame";
import { useRpcDraft } from "./rpc";
import "./settings-gui.css";

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
            <SettingsProvider value={ctx}>
                <Panel />
            </SettingsProvider>
        </FocusRoot>
    );
}

// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * A mock match's pause menu: Resume, Options, Forfeit. The shell's pause
 * dialog (`features/dialogs/PauseDialog.tsx`) in the same frame, with Forfeit
 * as a commit row (a click arms it, the second runs it; keys and pad confirm
 * once) because it ends the match and, in ranked, counts as a loss. No
 * Restart, no Briefing: a match is played once.
 */

import { useEffect, useState } from "react";

import { SettingsOptions } from "../../../screens/Settings";
import { ListRow, type Command } from "../../../ui";
import { DialogHost } from "../../dialogs/DialogHost";

const NAV: Command = { action: "nav", label: "Move", glyph: "ud" };

export function MatchPause({
    open,
    ranked,
    onResume,
    onForfeit,
}: {
    open: boolean;
    ranked: boolean;
    onResume: () => void;
    onForfeit: () => void;
}) {
    const [view, setView] = useState<"menu" | "options" | "back-from-options">("menu");
    useEffect(() => {
        if (!open) setView("menu");
    }, [open]);

    // While Options covers the field, the field's own interface steps aside.
    const over = open && view === "options";
    useEffect(() => {
        if (!over) return;
        const root = document.documentElement;
        root.dataset.overField = "";
        return () => {
            delete root.dataset.overField;
        };
    }, [over]);

    if (!open) return null;
    if (view === "options")
        return (
            <div className="gui-over-field">
                <SettingsOptions onBack={() => setView("back-from-options")} />
            </div>
        );

    return (
        <DialogHost
            back={{ action: "back", label: "Resume", run: onResume }}
            eyebrow="Match"
            title="Paused"
            initial={view === "back-from-options" ? "pause-options" : undefined}
            compact
        >
            <ListRow
                id="pause-resume"
                group="pause"
                name="Resume"
                title="Resume"
                instant
                commands={[
                    NAV,
                    { action: "confirm", label: "Resume", tone: "primary", run: onResume },
                ]}
            />
            <ListRow
                id="pause-options"
                group="pause"
                name="Options"
                title="Options"
                instant
                commands={[
                    NAV,
                    {
                        action: "confirm",
                        label: "Select",
                        tone: "primary",
                        run: () => setView("options"),
                    },
                ]}
            />
            <ListRow
                id="pause-forfeit"
                group="pause"
                name="Forfeit"
                title="Forfeit"
                hint={ranked ? "Ends the match; counts as a loss" : "Ends the match"}
                commands={[
                    NAV,
                    { action: "confirm", label: "Forfeit", tone: "danger", run: onForfeit },
                ]}
            />
        </DialogHost>
    );
}

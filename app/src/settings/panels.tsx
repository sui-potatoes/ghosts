// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type { ReactNode } from "react";

import { Slider, Switch } from "./controls";
import { DEFAULTS, useSettings } from "./store";

/** Button row under a panel's fields. */
export function Actions({ children }: { children: ReactNode }) {
    return <div className="flex flex-wrap gap-3 pt-4">{children}</div>;
}

/**
 * Audio and display preferences. Shared by the Settings screen and the
 * in-game pause menu, so a change made mid-encounter is the same change.
 */
export function AudioPanel() {
    const [settings, update] = useSettings();
    const { audio } = settings;
    const setAudio = (patch: Partial<typeof audio>) =>
        update((s) => ({ ...s, audio: { ...s.audio, ...patch } }));

    return (
        <>
            <Switch label="Mute" checked={audio.muted} onChange={(muted) => setAudio({ muted })} />
            <Slider
                label="Master"
                value={audio.master}
                disabled={audio.muted}
                onChange={(master) => setAudio({ master })}
            />
            <Slider
                label="Music"
                value={audio.music}
                disabled={audio.muted}
                onChange={(music) => setAudio({ music })}
            />
            <Slider
                label="Effects"
                value={audio.sfx}
                disabled={audio.muted}
                onChange={(sfx) => setAudio({ sfx })}
            />
            <Slider
                label="Dialogue"
                value={audio.voice}
                disabled={audio.muted}
                onChange={(voice) => setAudio({ voice })}
            />
            <Actions>
                <button
                    className="btn"
                    onClick={() => update((s) => ({ ...s, audio: DEFAULTS.audio }))}
                >
                    Reset to defaults
                </button>
            </Actions>
        </>
    );
}

export function DisplayPanel() {
    const [settings, update] = useSettings();
    const { display } = settings;
    const setDisplay = (patch: Partial<typeof display>) =>
        update((s) => ({ ...s, display: { ...s.display, ...patch } }));

    return (
        <>
            <Switch
                label="Battery saver"
                hint="Lower 3D resolution and pause idle battlefield rendering. Active play stays up to 60 FPS."
                checked={display.batterySaver}
                onChange={(batterySaver) => setDisplay({ batterySaver })}
            />
            <Switch
                label="Scanlines"
                hint="Faint horizontal grain over the whole screen."
                checked={display.scanlines}
                onChange={(scanlines) => setDisplay({ scanlines })}
            />
            <Switch
                label="Vignette"
                hint="Darkened edges."
                checked={display.vignette}
                onChange={(vignette) => setDisplay({ vignette })}
            />
            <Switch
                label="Reduce motion"
                hint="No pulses, shimmers or transitions."
                checked={display.reduceMotion}
                onChange={(reduceMotion) => setDisplay({ reduceMotion })}
            />
            <Actions>
                <button
                    className="btn"
                    onClick={() => update((s) => ({ ...s, display: DEFAULTS.display }))}
                >
                    Reset to defaults
                </button>
            </Actions>
        </>
    );
}

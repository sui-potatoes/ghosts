// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useState } from "react";
import { motions, type Motion } from "@ghosts/squad/motion/catalog";
import type { MotionState } from "@ghosts/squad/motion/player";
import type { RecruitStudio } from "@ghosts/squad/studio/recruit-studio";

interface Props {
    studio: RecruitStudio | null;
    state: MotionState;
    onBody(): void;
    civilian?: boolean;
}
export function MotionControls({ studio, state, onBody, civilian = false }: Props) {
    const available = civilian
        ? motions.filter(([id]) =>
              [
                  "idle_weight_shift",
                  "run",
                  "crouch_idle",
                  "hunker_down",
                  "take_damage",
                  "death",
              ].includes(id),
          )
        : motions;
    const [choice, setChoice] = useState<Motion>(civilian ? "idle_weight_shift" : "rifle_idle");
    const [loop, setLoop] = useState(true),
        [speed, setSpeed] = useState(1);
    const [loading, setLoading] = useState(false),
        [error, setError] = useState("");
    async function play() {
        if (!studio) return;
        onBody();
        setLoading(true);
        setError("");
        try {
            await studio.playMotion(choice, loop, speed);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Unable to play motion.");
        } finally {
            setLoading(false);
        }
    }
    return (
        <div className="motion-controls" aria-label="Motion drills">
            <label className="motion-picker">
                MOTION / {available.length}
                <select
                    aria-label="Motion"
                    value={choice}
                    onChange={(e) => {
                        studio?.stopMotion();
                        setChoice(e.target.value as Motion);
                    }}
                >
                    {[...new Set(available.map((m) => m[2]))].map((group) => (
                        <optgroup key={group} label={group}>
                            {available
                                .filter((m) => m[2] === group)
                                .map(([id, label]) => (
                                    <option key={id} value={id}>
                                        {civilian && id === "idle_weight_shift"
                                            ? "Crossed arms / civilian idle"
                                            : label}
                                    </option>
                                ))}
                        </optgroup>
                    ))}
                </select>
            </label>
            <div className="motion-actions">
                <button disabled={!studio || loading} onClick={() => void play()}>
                    {loading ? "Loading…" : "Play / restart"}
                </button>
                <button
                    disabled={!state.active || loading}
                    onClick={() => (state.playing ? studio?.pauseMotion() : studio?.resumeMotion())}
                >
                    {state.playing ? "Pause" : "Resume"}
                </button>
                <button disabled={!state.active || loading} onClick={() => studio?.stopMotion()}>
                    Reset pose
                </button>
                <label>
                    <input
                        type="checkbox"
                        checked={loop}
                        onChange={(e) => {
                            studio?.stopMotion();
                            setLoop(e.target.checked);
                        }}
                    />{" "}
                    Loop
                </label>
                <select
                    aria-label="Playback speed"
                    value={speed}
                    onChange={(e) => {
                        studio?.stopMotion();
                        setSpeed(Number(e.target.value));
                    }}
                >
                    <option value={0.5}>0.5×</option>
                    <option value={1}>1×</option>
                    <option value={1.5}>1.5×</option>
                </select>
            </div>
            <label className="motion-timeline">
                <span>
                    {state.time.toFixed(1)} / {state.duration.toFixed(1)}s
                </span>
                <input
                    aria-label="Motion position"
                    type="range"
                    min="0"
                    max={state.duration || 1}
                    step="0.01"
                    value={state.time}
                    disabled={!state.active || loading}
                    onChange={(e) => studio?.seekMotion(Number(e.target.value))}
                />
            </label>
            {error && <p role="alert">{error}</p>}
        </div>
    );
}

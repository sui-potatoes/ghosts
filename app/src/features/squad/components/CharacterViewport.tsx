// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { MotionControls } from "./MotionControls";
import { STOPPED, type MotionState } from "@ghosts/squad/motion/player";
import { useEffect, useRef, useState } from "react";
import type { Appearance, Recruit } from "@ghosts/squad/types";
import type { Focus, RecruitStudio } from "@ghosts/squad/studio/recruit-studio";
import type { CharacterLook } from "@ghosts/squad/studio/character-assets";

interface Props {
    recruit: Recruit;
    appearance: Appearance;
    recruits: Recruit[];
    focus: Focus;
    onFocus(value: Focus): void;
    onPortrait(id: string, url: string): void;
    onEquipment(images: Record<string, string>): void;
    /** The line above the callsign; defaults to the role. */
    eyebrow?: string;
}
export function CharacterViewport(props: Props) {
    const host = useRef<HTMLDivElement>(null),
        studio = useRef<RecruitStudio | null>(null),
        latest = useRef(props);
    latest.current = props;
    const [motion, setMotion] = useState<MotionState>(STOPPED);
    const [drills, setDrills] = useState(false);
    const [look, setLook] = useState<CharacterLook>("operative");
    const [ready, setReady] = useState(false),
        [error, setError] = useState(""),
        [attempt, setAttempt] = useState(0);
    useEffect(() => {
        let cancelled = false;
        void import("@ghosts/squad/studio/recruit-studio")
            .then(async ({ createRecruitStudio }) => {
                if (cancelled || !host.current) return;
                const view = createRecruitStudio(host.current, setMotion);
                studio.current = view;
                setReady(true);
                const images = await view.equipmentImages();
                if (!cancelled) latest.current.onEquipment(images);
            })
            .catch((e) => {
                if (!cancelled)
                    setError(e instanceof Error ? e.message : "The studio could not load.");
            });
        return () => {
            cancelled = true;
            studio.current?.dispose();
            studio.current = null;
        };
    }, [attempt]);
    useEffect(() => {
        if (!ready) return;
        let cancelled = false;
        setError("");
        const timer = window.setTimeout(() => {
            void studio.current
                ?.apply(props.recruit, props.appearance, look)
                .then(() => {
                    if (!cancelled) {
                        studio.current?.focus(latest.current.focus);
                    }
                })
                .catch((e) => {
                    if (!cancelled) {
                        setError(e instanceof Error ? e.message : "Unable to load operative.");
                    }
                });
        }, 90);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [ready, props.recruit, props.appearance, look]);
    useEffect(() => {
        studio.current?.focus(props.focus);
    }, [props.focus]);
    // Portraits for every recruit whose saved identity has not been drawn yet:
    // the roster at start, hires that arrive later, and looks saved since.
    const drawn = useRef(new Map<string, string>());
    useEffect(() => {
        if (!ready) return;
        let cancelled = false;
        const timer = window.setTimeout(async () => {
            for (const recruit of props.recruits) {
                const stamp = JSON.stringify(recruit.appearance);
                if (cancelled) return;
                if (drawn.current.get(recruit.id) === stamp) continue;
                const url = await studio.current?.portrait(recruit.appearance).catch(() => "");
                if (cancelled) return;
                if (url) {
                    drawn.current.set(recruit.id, stamp);
                    latest.current.onPortrait(recruit.id, url);
                }
            }
        }, 300);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [ready, props.recruits]);
    return (
        <section
            className={`recruit-stage ${drills ? "drills-open" : ""}`}
            aria-label="Recruit preview"
        >
            <div className="stage-identity">
                <span>
                    {look === "office-worker"
                        ? "EXTRACTION VIP / LOOK PREVIEW"
                        : (props.eyebrow ?? `${props.recruit.role} / ACTIVE ROSTER`)}
                </span>
                <h2>{props.recruit.callsign}</h2>
                <p>
                    {props.recruit.name}
                    {look === "office-worker" ? " · Office worker" : ""}
                </p>
            </div>
            <div
                ref={host}
                className="recruit-canvas"
                aria-label="3D recruit; drag horizontally to rotate and scroll to zoom"
            />
            {error && (
                <div className="studio-status studio-error" role="alert">
                    {error}
                    <button
                        onClick={() => {
                            setError("");
                            setReady(false);
                            setAttempt((value) => value + 1);
                        }}
                    >
                        Retry model
                    </button>
                </div>
            )}
            {drills && (
                <MotionControls
                    key={look}
                    civilian={look === "office-worker"}
                    studio={studio.current}
                    state={motion}
                    onBody={() => props.onFocus("body")}
                />
            )}
            <div className="stage-toolbar">
                <span>DRAG HORIZONTALLY</span>
                <div>
                    <button
                        aria-pressed={look === "office-worker"}
                        onClick={() => {
                            studio.current?.stopMotion();
                            props.onFocus("body");
                            setLook(look === "operative" ? "office-worker" : "operative");
                        }}
                    >
                        Office VIP
                    </button>
                    <button
                        aria-pressed={props.focus === "body"}
                        onClick={() => props.onFocus("body")}
                    >
                        Full body
                    </button>
                    <button
                        aria-pressed={props.focus === "face"}
                        onClick={() => props.onFocus("face")}
                    >
                        Face
                    </button>
                    <button onClick={() => studio.current?.view(0)}>Front</button>
                    <button onClick={() => studio.current?.view(Math.PI / 2)}>Profile</button>
                    <button
                        aria-expanded={drills}
                        onClick={() => {
                            if (drills) studio.current?.stopMotion();
                            else props.onFocus("body");
                            setDrills(!drills);
                        }}
                    >
                        Motion drills
                    </button>
                </div>
            </div>
        </section>
    );
}

// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { MotionControls } from "./MotionControls";
import { STOPPED, type MotionState } from "@ghosts/squad/motion/player";
import { useEffect, useRef, useState } from "react";
import type { Appearance, Recruit } from "@ghosts/squad/types";
import type { Focus, RecruitStudio } from "@ghosts/squad/studio/recruit-studio";

interface Props {
    recruit: Recruit;
    appearance: Appearance;
    recruits: Recruit[];
    focus: Focus;
    onFocus(value: Focus): void;
    onPortrait(id: string, url: string): void;
    onEquipment(images: Record<string, string>): void;
}
export function CharacterViewport(props: Props) {
    const host = useRef<HTMLDivElement>(null),
        studio = useRef<RecruitStudio | null>(null),
        latest = useRef(props);
    latest.current = props;
    const [motion, setMotion] = useState<MotionState>(STOPPED);
    const [drills, setDrills] = useState(false);
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
                if (cancelled) return;
                latest.current.onEquipment(images);
                for (const recruit of latest.current.recruits) {
                    if (cancelled) break;
                    const url = await view.portrait(recruit.appearance);
                    if (!cancelled && url) latest.current.onPortrait(recruit.id, url);
                }
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
                ?.apply(props.recruit, props.appearance)
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
    }, [ready, props.recruit, props.appearance]);
    useEffect(() => {
        studio.current?.focus(props.focus);
    }, [props.focus]);
    // Refresh only the changed recruit's portrait after the saved identity changes.
    useEffect(() => {
        if (!ready) return;
        let cancelled = false;
        const timer = window.setTimeout(() => {
            void studio.current
                ?.portrait(props.recruit.appearance)
                .then((url) => {
                    if (!cancelled && url) latest.current.onPortrait(props.recruit.id, url);
                })
                .catch(() => {});
        }, 600);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [ready, props.recruit.id, props.recruit.appearance]);
    return (
        <section
            className={`recruit-stage ${drills ? "drills-open" : ""}`}
            aria-label="Recruit preview"
        >
            <div className="stage-identity">
                <span>{props.recruit.role} / ACTIVE ROSTER</span>
                <h2>{props.recruit.callsign}</h2>
                <p>{props.recruit.name}</p>
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
                    studio={studio.current}
                    state={motion}
                    onBody={() => props.onFocus("body")}
                />
            )}
            <div className="stage-toolbar">
                <span>DRAG HORIZONTALLY</span>
                <div>
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

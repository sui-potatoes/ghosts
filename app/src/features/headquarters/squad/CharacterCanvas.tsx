// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The character stage canvas for the shared `StagePanel` (src/ui/stage.tsx):
 * the recruit studio from `@ghosts/squad/studio` mounted bare. Used by Headquarters and the `/ui-sample`
 * reference. The canvas hands the host a `StageControl` once its renderer is
 * up; the host owns the turn and the zoom steps.
 */

import type { RecruitStudio } from "@ghosts/squad/studio/recruit-studio";
import type { Appearance, Recruit } from "@ghosts/squad/types";
import { useEffect, useRef, useState } from "react";

import { useStageAttach } from "../../../ui";
import { useWireframe, wireframeColors } from "../../squad/useWireframe";

type CharacterCanvasProps = {
    recruit: Recruit;
    /** The look to show; a draft while Appearance is being edited. */
    appearance: Appearance;
    onState: (state: { loading: boolean; error?: string }) => void;
};

/**
 * The recruit studio from `@ghosts/squad/studio` mounted bare: the same
 * character, lighting and turntable Headquarters uses, without the
 * CharacterViewport's own toolbar. It draws only when something changes.
 */
export function CharacterCanvas({ recruit, appearance, onState }: CharacterCanvasProps) {
    const attach = useStageAttach();
    const host = useRef<HTMLDivElement>(null);
    const studio = useRef<RecruitStudio | null>(null);
    const [ready, setReady] = useState(false);
    const [wireframe] = useWireframe();
    const report = useRef(onState);
    report.current = onState;

    useEffect(() => {
        let cancelled = false;
        let detach: (() => void) | undefined;
        report.current({ loading: true });
        void import("@ghosts/squad/studio/recruit-studio")
            .then(({ createRecruitStudio }) => {
                if (cancelled || !host.current) return;
                const view = createRecruitStudio(host.current, () => {});
                studio.current = view;
                let face = false;
                detach = attach({
                    // The studio's camera orbits; the model turning right is the camera going left.
                    turn: (angle) => view.view(-angle),
                    zoom(step) {
                        if (step) {
                            face = step > 0;
                            view.focus(face ? "face" : "body");
                        }
                        return face ? "Face" : "Full";
                    },
                    // The studio's own drag speed (OrbitControls at 0.55).
                    dragRate: Math.PI * 2 * 0.55,
                });
                setReady(true);
            })
            .catch((e) => {
                if (!cancelled)
                    report.current({
                        loading: false,
                        error: e instanceof Error ? e.message : "The stage could not load.",
                    });
            });
        return () => {
            cancelled = true;
            detach?.();
            studio.current?.dispose();
            studio.current = null;
        };
    }, [attach]);

    // A different recruit takes a moment to build: the stage says so meanwhile.
    const shownId = useRef<string | null>(null);
    useEffect(() => {
        if (!ready) return;
        let cancelled = false;
        if (shownId.current !== null && shownId.current !== recruit.id)
            report.current({ loading: true });
        shownId.current = recruit.id;
        // Steppers fire quickly; a short settle keeps rebuilds to the last pick.
        const timer = window.setTimeout(() => {
            void studio.current
                ?.apply(recruit, appearance)
                .then(() => !cancelled && report.current({ loading: false }))
                .catch(
                    (e) =>
                        !cancelled &&
                        report.current({
                            loading: false,
                            error: e instanceof Error ? e.message : "Unable to load operative.",
                        }),
                );
        }, 90);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [ready, recruit, appearance]);

    useEffect(() => {
        if (ready && host.current)
            studio.current?.wireframe(wireframe, wireframeColors(host.current).line);
    }, [ready, wireframe]);

    return <div ref={host} className="gui-stage-canvas" data-kind="character" />;
}

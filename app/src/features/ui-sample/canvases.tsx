// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The sample's gear turntable (`weapon-stage.ts`), hosted by the shared
 * `StagePanel` (src/ui/stage.tsx). The character canvas is Headquarters'
 * own (`features/headquarters/squad/CharacterCanvas.tsx`).
 */

import type { Equipment, WeaponAttachments } from "@ghosts/squad/types";
import { useEffect, useRef, useState } from "react";

import { useStageAttach } from "../../ui";
import { useWireframe, wireframeColors } from "../squad/useWireframe";
import type { WeaponStage } from "./weapon-stage";

type GearCanvasProps = {
    /** Undefined empties the turntable; the canvas stays up for the next item. */
    model?: Equipment["model"];
    attachments?: WeaponAttachments;
    onState: (state: { loading: boolean; error?: string }) => void;
};

/** The Armory's gun builds on a bare turntable (`weapon-stage.ts`). */
export function GearCanvas({ model, attachments, onState }: GearCanvasProps) {
    const attach = useStageAttach();
    const host = useRef<HTMLDivElement>(null);
    const stage = useRef<WeaponStage | null>(null);
    const [ready, setReady] = useState(false);
    const [wireframe] = useWireframe();
    const report = useRef(onState);
    report.current = onState;

    useEffect(() => {
        let cancelled = false;
        let detach: (() => void) | undefined;
        report.current({ loading: true });
        void import("./weapon-stage")
            .then(({ createWeaponStage }) => {
                if (cancelled || !host.current) return;
                const view = createWeaponStage(host.current);
                stage.current = view;
                let near = 0;
                detach = attach({
                    turn: (angle) => view.turn(angle),
                    zoom(step) {
                        if (step) {
                            view.zoom(step);
                            near = Math.max(-3, Math.min(6, near + step));
                        }
                        return near > 0 ? `×${(1 / 0.82 ** near).toFixed(1)}` : "Full";
                    },
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
            stage.current?.dispose();
            stage.current = null;
        };
    }, [attach]);

    const fit = JSON.stringify(attachments ?? {});
    useEffect(() => {
        if (!ready) return;
        let cancelled = false;
        if (!model) {
            stage.current?.clear();
            report.current({ loading: false });
            return;
        }
        report.current({ loading: true });
        void stage.current
            ?.show(model, JSON.parse(fit))
            .then(() => !cancelled && report.current({ loading: false }))
            .catch(
                (e) =>
                    !cancelled &&
                    report.current({
                        loading: false,
                        error: e instanceof Error ? e.message : "Model unavailable.",
                    }),
            );
        return () => {
            cancelled = true;
        };
    }, [ready, model, fit]);

    useEffect(() => {
        if (ready && host.current)
            stage.current?.wireframe(wireframe, wireframeColors(host.current));
    }, [ready, wireframe, model, fit]);

    return <div ref={host} className="gui-stage-canvas" data-kind="gear" />;
}

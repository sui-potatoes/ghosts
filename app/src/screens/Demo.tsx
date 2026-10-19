// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { parseFrameMessage, type ShellMessage } from "../../demo-runtime/src/shell-bridge";
import { useBack } from "../hooks/useBack";
import { PauseMenu } from "../PauseMenu";

/**
 * A separate document owns the legacy renderer and keyboard handlers.
 * Unmounting it stops the encounter and releases its WebGL/audio context.
 *
 * The frame reports a back key it did not use (no targeting, no dialog open)
 * and this screen answers with the pause menu, telling the frame to freeze
 * while it is up. A back key that reaches this document directly does the
 * same, so Escape never leaves the encounter by accident.
 */
export default function Demo() {
    const navigate = useNavigate();
    const frame = useRef<HTMLIFrameElement>(null);
    const [paused, setPaused] = useState(false);

    const send = useCallback((message: ShellMessage) => {
        frame.current?.contentWindow?.postMessage(message, location.origin);
    }, []);

    useEffect(() => {
        function onMessage(e: MessageEvent) {
            if (e.origin !== location.origin || e.source !== frame.current?.contentWindow) return;
            if (parseFrameMessage(e.data)?.type === "ghosts:pause-request") setPaused(true);
        }
        window.addEventListener("message", onMessage);
        return () => window.removeEventListener("message", onMessage);
    }, []);

    useEffect(() => {
        send({ type: "ghosts:pause", paused });
        if (!paused) frame.current?.contentWindow?.focus();
    }, [paused, send]);

    useBack(() => setPaused(true));

    return (
        <>
            <iframe
                ref={frame}
                title="Ghosts — Tokyo street playtest"
                src={`${import.meta.env.BASE_URL}demo-runtime/index.html`}
                className="fixed inset-0 h-dvh w-full border-0 bg-surface"
                allow="fullscreen"
            />
            <PauseMenu
                open={paused}
                onResume={() => setPaused(false)}
                onRestart={() => {
                    send({ type: "ghosts:restart" });
                    setPaused(false);
                }}
                onQuit={() => navigate("/")}
            />
        </>
    );
}

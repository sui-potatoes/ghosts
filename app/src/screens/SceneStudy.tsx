// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import source from "../assets/menu-night-1672.webp";
import type { CityStudy, StudyMode } from "../components/projected-city";

export default function SceneStudy() {
    const host = useRef<HTMLDivElement>(null);
    const controller = useRef<CityStudy | null>(null);
    const [mode, setMode] = useState<StudyMode>("scene");
    const [motion, setMotion] = useState(
        () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
    const [ready, setReady] = useState(false);
    const [error, setError] = useState(false);
    useEffect(() => {
        let cancelled = false;
        void import("../components/projected-city")
            .then(({ createProjectedCity }) => {
                if (!cancelled && host.current)
                    controller.current = createProjectedCity(host.current, () => setReady(true));
            })
            .catch(() => {
                if (!cancelled) setError(true);
            });
        return () => {
            cancelled = true;
            controller.current?.dispose();
            controller.current = null;
        };
    }, []);
    function select(value: StudyMode) {
        setMode(value);
        controller.current?.setMode(value);
    }
    return (
        <main className="scene-study">
            <img src={source} alt="Rain-soaked city at night" className="study-source" />
            <div
                ref={host}
                className={`study-canvas ${mode === "source" ? "study-canvas-hidden" : ""}`}
                aria-label="Interactive projected city; drag to move the camera slightly"
            />
            <header className="study-header">
                <div>
                    <p className="label">GHOSTS / ENVIRONMENT STUDY</p>
                    <h1>After curfew.</h1>
                </div>
                <Link to="/" className="label">
                    Back to menu ↗
                </Link>
            </header>
            <footer className="study-controls">
                <div className="study-caption">
                    <span className="label">
                        {error
                            ? "WebGL unavailable — showing source"
                            : !ready
                              ? "Preparing scene…"
                              : mode === "source"
                                ? "Original image"
                                : mode === "geometry"
                                  ? "Reconstructed surface mesh"
                                  : "Live Three.js · drag to explore"}
                    </span>
                    <p>
                        Camera-projected street and façades. Rain, mist and wet-road shimmer. Small
                        camera movements only.
                    </p>
                </div>
                <div className="study-buttons" aria-label="Scene comparison">
                    {(
                        [
                            ["scene", "Live scene"],
                            ["source", "Source image"],
                            ["geometry", "Geometry"],
                        ] as const
                    ).map(([value, label]) => (
                        <button
                            disabled={!ready}
                            key={value}
                            aria-pressed={mode === value}
                            onClick={() => select(value)}
                        >
                            {label}
                        </button>
                    ))}
                    <button
                        disabled={!ready || mode === "source"}
                        aria-pressed={!motion}
                        onClick={() => {
                            setMotion(!motion);
                            controller.current?.setMotion(!motion);
                        }}
                    >
                        {motion ? "Pause" : "Resume"}
                    </button>
                    <button
                        disabled={!ready || mode === "source"}
                        onClick={() => controller.current?.reset()}
                    >
                        Reset view
                    </button>
                </div>
            </footer>
        </main>
    );
}

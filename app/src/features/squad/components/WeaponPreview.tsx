// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useEffect, useRef, useState } from "react";
import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { acquireArmoryWeapon, isArmoryGun } from "@ghosts/squad/studio/armory-weapons";
import { loadArmorySkin, type ArmorySkin } from "@ghosts/squad/studio/armory-skins";
import { EquipmentAssets } from "@ghosts/squad/studio/equipment-assets";
import { applyWireframe, formatMeshStats, meshStats } from "@ghosts/squad/studio/wireframe";
import type { Equipment, WeaponAttachments } from "@ghosts/squad/types";
import { FACTORY_SKIN } from "@ghosts/squad/weapon-skins";
import { useWireframe, useWireframeShortcut, wireframeColors } from "../useWireframe";

/** Product-lighting inspection of the actual equipped assembly, with full orbit and zoom. */
export function WeaponPreview({
    item,
    attachments,
    skin,
}: {
    item: Equipment;
    attachments?: WeaponAttachments;
    /** A weapon skin id (`@ghosts/squad/weapon-skins`); Factory when unset. */
    skin?: string;
}) {
    const [error, setError] = useState("");
    const [expanded, setExpanded] = useState(false);
    const [wireframe, setWireframe] = useWireframe();
    const [stats, setStats] = useState("");
    useWireframeShortcut();
    const dialog = useRef<HTMLDialogElement>(null);
    useEffect(() => {
        if (expanded) dialog.current?.showModal();
        else dialog.current?.close();
    }, [expanded]);
    return (
        <>
            <div className="weapon-preview">
                <WeaponCanvas
                    item={item}
                    attachments={attachments}
                    skin={skin}
                    wireframe={wireframe}
                    onStats={setStats}
                    onError={setError}
                />
                {wireframe && stats && <span className="weapon-wire-stats">{stats}</span>}
                <div className="weapon-preview-caption">
                    <span>Drag to rotate · scroll to zoom</span>
                    <span className="weapon-preview-actions">
                        <button
                            aria-pressed={wireframe}
                            title="Wireframe (Z)"
                            onClick={() => setWireframe(!wireframe)}
                        >
                            Wireframe
                        </button>
                        <button onClick={() => setExpanded(true)}>Inspect ↗</button>
                    </span>
                </div>
                {error && (
                    <p role="alert" className="sq-error">
                        {error}
                    </p>
                )}
            </div>
            <dialog className="weapon-inspect" ref={dialog} onCancel={() => setExpanded(false)}>
                <header>
                    <div>
                        <span className="sq-eyebrow">ARMORY / INSPECTION</span>
                        <h2>{item.name}</h2>
                    </div>
                    <span className="weapon-preview-actions">
                        <button
                            aria-pressed={wireframe}
                            title="Wireframe (Z)"
                            onClick={() => setWireframe(!wireframe)}
                        >
                            Wireframe
                        </button>
                        <button
                            autoFocus
                            aria-label="Close weapon inspection"
                            onClick={() => setExpanded(false)}
                        >
                            Close ×
                        </button>
                    </span>
                </header>
                <div className="weapon-inspect-stage">
                    {expanded && (
                        <WeaponCanvas
                            item={item}
                            attachments={attachments}
                            skin={skin}
                            wireframe={wireframe}
                            onStats={setStats}
                            onError={setError}
                        />
                    )}
                    {expanded && wireframe && stats && (
                        <span className="weapon-wire-stats">{stats}</span>
                    )}
                </div>
                <p>Drag to rotate · scroll to zoom · right-drag to pan</p>
            </dialog>
        </>
    );
}

function WeaponCanvas({
    item,
    attachments,
    skin,
    wireframe,
    onStats,
    onError,
}: {
    item: Equipment;
    attachments?: WeaponAttachments;
    skin?: string;
    wireframe: boolean;
    onStats(text: string): void;
    onError(message: string): void;
}) {
    const host = useRef<HTMLDivElement>(null);
    // The wireframe switch reaches into the running scene without rebuilding it.
    const wire = useRef<(on: boolean) => void>(undefined);
    const latest = useRef(wireframe);
    latest.current = wireframe;
    useEffect(() => wire.current?.(wireframe), [wireframe]);
    useEffect(() => {
        const element = host.current;
        if (!element) return;
        let disposed = false;
        const assets = new EquipmentAssets();
        let renderer: T.WebGLRenderer;
        try {
            renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
        } catch {
            onError("Weapon preview could not start WebGL");
            return;
        }
        renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
        renderer.toneMapping = T.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.15;
        renderer.outputColorSpace = T.SRGBColorSpace;
        renderer.domElement.setAttribute("aria-label", `${item.name} interactive 3D preview`);
        renderer.domElement.setAttribute("role", "img");
        element.append(renderer.domElement);
        const scene = new T.Scene();
        const pmrem = new T.PMREMGenerator(renderer);
        const room = new RoomEnvironment();
        const environment = pmrem.fromScene(room, 0.04);
        scene.environment = environment.texture;
        scene.environmentIntensity = 0.65;
        room.dispose();
        pmrem.dispose();
        scene.add(new T.HemisphereLight(0xdce6e7, 0x1b242b, 1));
        for (const [position, color, intensity] of [
            [[-0.5, 1.5, 1], 0xfff3dc, 3.8],
            [[0.5, 0.4, -1], 0xb1dce5, 3],
            [[1, -0.2, 0.6], 0xffffff, 0.8],
        ] as const) {
            const light = new T.DirectionalLight(color, intensity);
            light.position.fromArray(position);
            scene.add(light);
        }
        const camera = new T.PerspectiveCamera(32, 1, 0.01, 20);
        camera.position.set(0.35, 0.23, 1.4);
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = false;
        controls.minDistance = 0.25;
        controls.maxDistance = 3.5;
        const draw = () => {
            if (!disposed) renderer.render(scene, camera);
        };
        let extent = 0.85;
        let shown: T.Object3D | undefined;
        let unwire: (() => void) | undefined;
        wire.current = (on) => {
            unwire?.();
            // The laser trace is an unlit effect: it has no wireframe, so it hides.
            shown?.traverse((o) => {
                if (o.userData.laserTrace) o.visible = !on;
            });
            unwire = on && shown ? applyWireframe(shown, wireframeColors(element)) : undefined;
            draw();
        };
        const resize = () => {
            const { width, height } = element.getBoundingClientRect();
            if (!width || !height) return;
            renderer.setSize(width, height, false);
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
            const distance =
                (extent /
                    (2 *
                        Math.tan(T.MathUtils.degToRad(camera.fov / 2)) *
                        Math.min(camera.aspect, 2.7))) *
                1.3;
            camera.position.set(distance * 0.45, distance * 0.27, distance);
            controls.target.set(0, 0, 0);
            controls.update();
            draw();
        };
        const observer = new ResizeObserver(resize);
        observer.observe(element);
        controls.addEventListener("change", draw);
        // The Armory shows the redesigned long guns; everything else (and every
        // character) keeps the baked assets through EquipmentAssets.
        let release: (() => void) | undefined;
        const load = async () => {
            if (!isArmoryGun(item.model)) return assets.get(item.model, attachments);
            // A skin's files are fetched the first time it is shown; if they
            // cannot be had, the gun shows in its factory finish.
            let finish: ArmorySkin | undefined;
            if (skin && skin !== FACTORY_SKIN)
                finish = await loadArmorySkin(item.model, skin).catch(() => undefined);
            const weapon = acquireArmoryWeapon(item.model, attachments, finish);
            if (disposed) weapon.release();
            else release = weapon.release;
            return weapon.model;
        };
        void load()
            .then((model) => {
                if (disposed) return;
                // Framing measures the gun, not the laser trace beyond its muzzle.
                const traces = model.children.filter((o) => o.userData.laserTrace);
                traces.forEach((o) => model.remove(o));
                const bounds = new T.Box3().setFromObject(model);
                if (traces.length) model.add(...traces);
                extent = bounds.getSize(new T.Vector3()).x;
                model.position.sub(bounds.getCenter(new T.Vector3()));
                scene.add(model);
                shown = model;
                onStats(formatMeshStats(meshStats(model)));
                wire.current?.(latest.current);
                onError("");
                resize();
            })
            .catch((e) => {
                if (!disposed) onError(e instanceof Error ? e.message : "Weapon asset unavailable");
            });
        return () => {
            disposed = true;
            unwire?.();
            wire.current = undefined;
            observer.disconnect();
            controls.dispose();
            release?.();
            assets.dispose();
            environment.dispose();
            renderer.dispose();
            renderer.forceContextLoss();
            renderer.domElement.remove();
        };
    }, [item, attachments, skin, onError, onStats]);
    return <div className="weapon-canvas" ref={host} />;
}

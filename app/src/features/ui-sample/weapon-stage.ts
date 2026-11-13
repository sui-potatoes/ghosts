// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * A turntable for one piece of gear, built on the same pieces the Armory's
 * WeaponPreview uses (the redesigned long guns from `acquireArmoryWeapon`,
 * every other model through `EquipmentAssets`, product lighting from a room
 * environment) but with no chrome of its own: the sample's frame and command
 * bar own the controls. Renders on demand only — a frame per change, nothing
 * while the model sits still. Loaded on its own chunk with three.js.
 */

import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { acquireArmoryWeapon, isArmoryGun } from "@ghosts/squad/studio/armory-weapons";
import { EquipmentAssets } from "@ghosts/squad/studio/equipment-assets";
import { applyWireframe, type WireframeColors } from "@ghosts/squad/studio/wireframe";
import type { Equipment, WeaponAttachments } from "@ghosts/squad/types";

export interface WeaponStage {
    /** Show a model; resolves once it is on the turntable. Superseded calls resolve quietly. */
    show(model: Equipment["model"], attachments?: WeaponAttachments): Promise<void>;
    /** Empty the turntable (gear with no model in the game). */
    clear(): void;
    /** Turn the turntable to `angle` radians (absolute; the stage host owns it). */
    turn(angle: number): void;
    /** Step the camera in (1) or out (−1). */
    zoom(step: 1 | -1): void;
    wireframe(on: boolean, colors: WireframeColors): void;
    dispose(): void;
}

export function createWeaponStage(host: HTMLElement): WeaponStage {
    const renderer = new T.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: "low-power",
    });
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.outputColorSpace = T.SRGBColorSpace;
    host.append(renderer.domElement);

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

    const camera = new T.PerspectiveCamera(30, 1, 0.01, 20);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.enablePan = false;
    controls.minDistance = 0.25;
    controls.maxDistance = 3.5;

    const turntable = new T.Group();
    scene.add(turntable);
    const assets = new EquipmentAssets();
    let shown: T.Object3D | undefined;
    let release: (() => void) | undefined;
    let unwire: (() => void) | undefined;
    let wire: WireframeColors | null = null;
    let extent = 0.85;
    let ticket = 0;
    let raf = 0;
    let disposed = false;

    const draw = () => {
        if (!disposed && !document.hidden) renderer.render(scene, camera);
    };
    const schedule = () => {
        if (!raf && !disposed)
            raf = requestAnimationFrame(() => {
                raf = 0;
                draw();
            });
    };
    controls.addEventListener("change", schedule);
    document.addEventListener("visibilitychange", schedule);

    /** Three-quarter view from slightly above, the gun filling the stage's width. */
    const frame = () => {
        const tan = 2 * Math.tan(T.MathUtils.degToRad(camera.fov / 2));
        const distance = (extent / (tan * Math.min(camera.aspect, 2.4))) * 1.25;
        const dir = new T.Vector3(0.42, 0.22, 1).normalize();
        camera.position.copy(dir.multiplyScalar(distance));
        controls.target.set(0, 0, 0);
        controls.update();
        schedule();
    };

    const resize = () => {
        const { width, height } = host.getBoundingClientRect();
        if (!width || !height) return;
        renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        frame();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    const applyWire = () => {
        unwire?.();
        unwire = undefined;
        shown?.traverse((o) => {
            // The laser trace is an unlit effect with no wireframe of its own.
            if (o.userData.laserTrace) o.visible = !wire;
        });
        if (wire && shown) unwire = applyWireframe(shown, wire);
        schedule();
    };

    return {
        async show(model, attachments = {}) {
            const mine = ++ticket;
            let object: T.Object3D;
            let letGo: (() => void) | undefined;
            if (isArmoryGun(model)) {
                const weapon = acquireArmoryWeapon(model, attachments);
                object = weapon.model;
                letGo = weapon.release;
            } else {
                object = await assets.get(model, attachments);
            }
            if (disposed || mine !== ticket) {
                letGo?.();
                return;
            }
            unwire?.();
            unwire = undefined;
            if (shown) turntable.remove(shown);
            release?.();
            release = letGo;
            // Frame by the body, not the laser trace beyond the muzzle.
            const traces = object.children.filter((o) => o.userData.laserTrace);
            traces.forEach((o) => object.remove(o));
            const bounds = new T.Box3().setFromObject(object);
            if (traces.length) object.add(...traces);
            const size = bounds.getSize(new T.Vector3());
            extent = Math.max(size.x, size.y * 1.6, size.z, 0.12);
            object.position.sub(bounds.getCenter(new T.Vector3()));
            turntable.add(object);
            shown = object;
            applyWire();
            resize();
        },
        clear() {
            ticket++;
            unwire?.();
            unwire = undefined;
            if (shown) turntable.remove(shown);
            shown = undefined;
            release?.();
            release = undefined;
            schedule();
        },
        turn(angle) {
            turntable.rotation.y = angle;
            schedule();
        },
        zoom(step) {
            const offset = camera.position.clone().sub(controls.target);
            const next = T.MathUtils.clamp(
                offset.length() * (step > 0 ? 0.82 : 1 / 0.82),
                controls.minDistance,
                controls.maxDistance,
            );
            camera.position.copy(controls.target).add(offset.setLength(next));
            controls.update();
            schedule();
        },
        wireframe(on, colors) {
            wire = on ? colors : null;
            applyWire();
        },
        dispose() {
            disposed = true;
            cancelAnimationFrame(raf);
            unwire?.();
            observer.disconnect();
            document.removeEventListener("visibilitychange", schedule);
            controls.dispose();
            release?.();
            assets.dispose();
            environment.dispose();
            renderer.dispose();
            renderer.forceContextLoss();
            renderer.domElement.remove();
        },
    };
}

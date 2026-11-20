// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Gear thumbnails for both Headquarters sections: every catalog item and
 * mod drawn once under product lighting (a room environment plus key, fill
 * and rim lights, the Armory stage's own look), framed to fill a 4:3 plate,
 * on a transparent background so the row's plate shows through. The long
 * guns and the grenades are the Armory's redesigned builds, the rest the
 * game's models through `EquipmentAssets`. Loaded on its own chunk with
 * three.js; the renderer is gone once the set is drawn.
 */

import * as T from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { ATTACHMENTS, EQUIPMENT } from "@ghosts/squad/catalog";
import { acquireArmoryWeapon, isArmoryGun } from "@ghosts/squad/studio/armory-weapons";
import { acquireArmoryUtility, isArmoryUtility } from "@ghosts/squad/studio/armory-utilities";
import { EquipmentAssets } from "@ghosts/squad/studio/equipment-assets";

const WIDTH = 256;
const HEIGHT = 192;

/** A breath between items, so drawing the set never freezes the screen. */
const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export async function drawGearThumbnails(): Promise<Record<string, string>> {
    const canvas = document.createElement("canvas");
    const renderer = new T.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
        powerPreference: "low-power",
    });
    renderer.setPixelRatio(1);
    renderer.setSize(WIDTH, HEIGHT, false);
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = T.ACESFilmicToneMapping;
    // Brighter than the stage: dark gunmetal has to read at row size.
    renderer.toneMappingExposure = 1.6;
    renderer.outputColorSpace = T.SRGBColorSpace;

    const scene = new T.Scene();
    const pmrem = new T.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const environment = pmrem.fromScene(room, 0.04);
    scene.environment = environment.texture;
    scene.environmentIntensity = 0.9;
    room.dispose();
    pmrem.dispose();
    scene.add(new T.HemisphereLight(0xe6eef0, 0x2a3238, 1.4));
    for (const [position, color, intensity] of [
        // key from the upper left, fill from the right, and a rim from behind
        // that draws the silhouette's edge against the plate
        [[-0.6, 1.2, 1.4], 0xfff3dc, 4.2],
        [[1.2, 0.3, 0.8], 0xd6e6ea, 1.6],
        [[0.2, 0.8, -1.4], 0xb8e2ec, 3.4],
    ] as const) {
        const light = new T.DirectionalLight(color, intensity);
        light.position.fromArray(position);
        scene.add(light);
    }

    const camera = new T.PerspectiveCamera(28, WIDTH / HEIGHT, 0.01, 50);
    const assets = new EquipmentAssets();
    const out: Record<string, string> = {};

    const draw = (object: T.Object3D): string => {
        // Frame by the body, not a laser's trace beyond the muzzle.
        const traces: T.Object3D[] = [];
        object.traverse((o) => {
            if (o.userData.laserTrace) traces.push(o);
        });
        traces.forEach((o) => (o.visible = false));
        object.updateMatrixWorld(true);
        const bounds = new T.Box3().setFromObject(object, true);
        const center = bounds.getCenter(new T.Vector3());
        const size = bounds.getSize(new T.Vector3());
        object.position.sub(center);
        scene.add(object);
        // Fill the plate: the larger of width and height decides, with a hair of margin.
        const tan = Math.tan(T.MathUtils.degToRad(camera.fov / 2));
        const fitHeight = size.y / 2 / tan;
        const fitWidth = size.x / 2 / (tan * camera.aspect);
        const distance = Math.max(fitHeight, fitWidth) * 1.12 + size.z / 2;
        camera.position.set(distance * 0.08, distance * 0.06, distance);
        camera.near = distance / 100;
        camera.far = distance * 10;
        camera.lookAt(0, 0, 0);
        camera.updateProjectionMatrix();
        renderer.render(scene, camera);
        scene.remove(object);
        return canvas.toDataURL("image/webp", 0.9);
    };

    try {
        for (const item of EQUIPMENT) {
            let object: T.Object3D;
            let release: (() => void) | undefined;
            if (isArmoryGun(item.model)) {
                const gun = acquireArmoryWeapon(item.model);
                object = gun.model;
                release = gun.release;
            } else if (isArmoryUtility(item.model)) {
                const utility = acquireArmoryUtility(item.model);
                object = utility.model;
                release = utility.release;
            } else object = await assets.get(item.model);
            out[item.id] = draw(object);
            release?.();
            await breathe();
        }
        for (const item of ATTACHMENTS) {
            const object = await assets.attachment(item.id);
            // Mods come in the hand socket's frame: turned to lie like the gun's side.
            object.quaternion.setFromRotationMatrix(
                new T.Matrix4().makeBasis(
                    new T.Vector3(0, 0, -1),
                    new T.Vector3(1, 0, 0),
                    new T.Vector3(0, -1, 0),
                ),
            );
            const holder = new T.Group().add(object);
            out[item.id] = draw(holder);
            await breathe();
        }
        return out;
    } finally {
        assets.dispose();
        environment.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
    }
}

// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createSidearm } from "./sidearm";
import { assetUrl } from "./character-assets";
import type { Equipment } from "../types";
export class EquipmentAssets {
    private models = new Map<string, Promise<T.Group>>();
    get(type: Equipment["model"]): Promise<T.Group> {
        if (!this.models.has(type)) this.models.set(type, this.create(type));
        return this.models.get(type)!.then((g) => g.clone());
    }
    private async create(type: Equipment["model"]) {
        const group = new T.Group();
        group.userData.model = type;
        const metal = new T.MeshStandardMaterial({
            color: 0x485b66,
            metalness: 0.65,
            roughness: 0.5,
        });
        const dark = new T.MeshStandardMaterial({ color: 0x202d35, roughness: 0.8 });
        const pale = new T.MeshStandardMaterial({ color: 0xb8c3bb, roughness: 0.6 });
        const box = (
            x: number,
            y: number,
            z: number,
            w: number,
            h: number,
            d: number,
            m: T.Material,
        ) => {
            const mesh = new T.Mesh(new T.BoxGeometry(w, h, d), m);
            mesh.position.set(x, y, z);
            group.add(mesh);
        };
        if (type === "rifle" || type === "sniper") {
            const gltf = await new GLTFLoader().loadAsync(assetUrl("equipment/rifle.glb"));
            gltf.scene.quaternion.setFromRotationMatrix(
                new T.Matrix4().makeBasis(
                    new T.Vector3(0, 0, -1),
                    new T.Vector3(1, 0, 0),
                    new T.Vector3(0, -1, 0),
                ),
            );
            gltf.scene.traverse((o) => {
                if (o instanceof T.Mesh) {
                    const mat = o.material as T.MeshStandardMaterial;
                    mat.color.set("#414853");
                    mat.metalness = 0.35;
                    mat.roughness = 0.5;
                }
            });
            group.add(gltf.scene);
            if (type === "sniper") {
                const scope = new T.Mesh(new T.CylinderGeometry(0.028, 0.028, 0.22, 12), metal);
                scope.rotation.z = Math.PI / 2;
                scope.position.set(-0.03, 0.14, 0);
                group.add(scope);
                box(-0.05, 0.1, 0, 0.08, 0.05, 0.035, dark);
                const barrel = new T.Mesh(new T.CylinderGeometry(0.012, 0.012, 0.14, 8), dark);
                barrel.rotation.z = Math.PI / 2;
                barrel.position.set(0.38, 0.045, 0);
                group.add(barrel);
            }
        } else if (type === "pistol") {
            const pistol = createSidearm();
            pistol.quaternion.setFromRotationMatrix(
                new T.Matrix4().makeBasis(
                    new T.Vector3(0, 0, -1),
                    new T.Vector3(1, 0, 0),
                    new T.Vector3(0, -1, 0),
                ),
            );
            group.add(pistol);
        } else if (
            type === "armor" ||
            type === "assassin-armor" ||
            type === "assassin-mid" ||
            type === "assassin-heavy"
        ) {
            const paths = [
                {
                    armor: "spectre",
                    "assassin-armor": "nyx",
                    "assassin-mid": "nyx-mid",
                    "assassin-heavy": "nyx-heavy",
                }[type] + "-male",
            ];
            for (const path of paths) {
                const gltf = await new GLTFLoader().loadAsync(
                    assetUrl(`armor/${path}.glb?v=${type === "armor" ? 4 : 8}`),
                );
                gltf.scene.traverse((o) => {
                    if (o instanceof T.Mesh) group.add(new T.Mesh(o.geometry, o.material));
                });
            }
        } else if (type === "grenade") {
            const shell = new T.Mesh(new T.CapsuleGeometry(0.09, 0.12, 4, 12), metal);
            group.add(shell);
            box(0, 0.18, 0, 0.08, 0.06, 0.07, dark);
            box(0.05, 0.12, 0, 0.03, 0.16, 0.06, pale);
            const pin = new T.Mesh(new T.TorusGeometry(0.045, 0.006, 5, 12), pale);
            pin.position.set(-0.06, 0.19, 0);
            group.add(pin);
            for (const y of [-0.07, 0, 0.07]) {
                const ring = new T.Mesh(new T.TorusGeometry(0.092, 0.004, 4, 12), dark);
                ring.rotation.x = Math.PI / 2;
                ring.position.y = y;
                group.add(ring);
            }
        } else {
            box(0, 0, 0, 0.3, 0.2, 0.1, dark);
            box(0, 0.025, 0.056, 0.12, 0.025, 0.005, pale);
            box(0, 0.025, 0.058, 0.025, 0.12, 0.005, pale);
            box(0, 0.12, 0, 0.16, 0.03, 0.06, metal);
        }
        const bounds = new T.Box3().setFromObject(group),
            center = bounds.getCenter(new T.Vector3());
        for (const child of group.children) child.position.sub(center);
        group.userData.center = center.toArray();
        // The unused small helper materials are cheap but still explicitly released.
        for (const mat of [metal, dark, pale]) {
            let used = false;
            group.traverse((o) => {
                if (o instanceof T.Mesh && o.material === mat) used = true;
            });
            if (!used) mat.dispose();
        }
        return group;
    }
    dispose() {
        for (const p of this.models.values())
            void p
                .then((group) => {
                    const gs = new Set<T.BufferGeometry>(),
                        ms = new Set<T.Material>();
                    group.traverse((o) => {
                        if (o instanceof T.Mesh) {
                            gs.add(o.geometry);
                            for (const m of Array.isArray(o.material) ? o.material : [o.material])
                                ms.add(m);
                        }
                    });
                    gs.forEach((g) => g.dispose());
                    ms.forEach((m) => {
                        for (const v of Object.values(m)) if (v instanceof T.Texture) v.dispose();
                        m.dispose();
                    });
                })
                .catch(() => {});
    }
}

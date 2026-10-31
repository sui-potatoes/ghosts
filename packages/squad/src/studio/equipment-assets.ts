// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createFieldSupply } from "./field-supplies";
import { ATTACHMENT_SLOTS, attachmentById } from "../catalog";
import { createSidearm } from "./sidearm";
import { assetUrl } from "./character-assets";
import type { Equipment, WeaponAttachments } from "../types";
export class EquipmentAssets {
    private models = new Map<string, Promise<T.Group>>();
    private disposed = false;
    async get(type: Equipment["model"], attachments: WeaponAttachments = {}): Promise<T.Group> {
        if (this.disposed) throw Error("Equipment assets disposed.");
        if (!this.models.has(type)) this.models.set(type, this.create(type));
        const source = await this.models.get(type)!;
        if (this.disposed) throw Error("Equipment assets disposed.");
        const model = source.clone();
        if (type === "rifle" || type === "sniper" || type === "plasma") {
            for (const slot of ATTACHMENT_SLOTS) {
                const item = attachmentById(attachments[slot]);
                if (item?.slot !== slot) continue;
                let mount: T.Object3D | undefined;
                model.traverse((node) => {
                    if (node.userData.interface === `ghosts:${slot}:v1`) mount = node;
                });
                if (mount) {
                    mount.clear();
                    mount.add(await this.attachment(item.id));
                }
            }
        }
        return model;
    }
    async attachment(id: string): Promise<T.Group> {
        if (this.disposed) throw Error("Equipment assets disposed.");
        if (!attachmentById(id)) throw Error("Unknown attachment.");
        const key = `attachment:${id}`;
        if (!this.models.has(key)) this.models.set(key, this.loadWeaponAsset(id));
        const source = await this.models.get(key)!;
        if (this.disposed) throw Error("Equipment assets disposed.");
        return source.clone();
    }
    private async loadWeaponAsset(id: string): Promise<T.Group> {
        const gltf = await new GLTFLoader().loadAsync(assetUrl(`weapons/${id}.glb?v=3`));
        return gltf.scene;
    }
    private async create(type: Equipment["model"]) {
        const group = new T.Group();
        group.userData.model = type;
        if (type === "rifle" || type === "sniper" || type === "plasma") {
            const gun = await this.loadWeaponAsset(type);
            gun.quaternion.setFromRotationMatrix(
                new T.Matrix4().makeBasis(
                    new T.Vector3(0, 0, -1),
                    new T.Vector3(1, 0, 0),
                    new T.Vector3(0, -1, 0),
                ),
            );
            group.add(gun);
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
                    assetUrl(`armor/${path}.glb?v=${type === "armor" ? 7 : 10}`),
                );
                gltf.scene.traverse((o) => {
                    if (o instanceof T.Mesh) group.add(new T.Mesh(o.geometry, o.material));
                });
            }
        } else {
            group.add(createFieldSupply(type));
        }
        const bounds = new T.Box3().setFromObject(group),
            center = bounds.getCenter(new T.Vector3());
        for (const child of group.children) child.position.sub(center);
        group.userData.center = center.toArray();
        return group;
    }
    dispose() {
        this.disposed = true;
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

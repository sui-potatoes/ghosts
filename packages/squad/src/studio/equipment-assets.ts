// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import { createGLTFLoader } from "./gltf-loader";
import { createRailUpgrade } from "./rail-upgrades";
import { createFurnitureUpgrade } from "./furniture-upgrades";
import { createServiceFurniture } from "./service-rifle";
import { familyFinish } from "./rifle-shapes";
import { createFieldSupply } from "./field-supplies";
import { attachmentById } from "../catalog";
import { createSidearm } from "./sidearm";
import { assetUrl } from "./character-assets";
import type { Equipment, WeaponAttachments } from "../types";
import {
    HOLDER_BASIS,
    acquireHeldWeapon,
    heldFittings,
    isHeldGun,
    type HeldGun,
} from "./held-weapons";
import type { Detail } from "./rifle-shapes";
import type { AttachmentSlot } from "../types";

function createFitting(slot: AttachmentSlot, tier: number): T.Group {
    const level = tier as 1 | 2 | 3,
        m = familyFinish();
    if (slot === "scope" || slot === "laser") return createRailUpgrade(slot, level, "high", m);
    try {
        return createFurnitureUpgrade(slot, "rifle", level, "high", m);
    } catch {
        return createServiceFurniture(slot, m);
    }
}
export class EquipmentAssets {
    private models = new Map<string, Promise<T.Group>>();
    private held = new Map<string, { group: T.Group; release: () => void }>();
    private disposed = false;
    /** Detail of the long guns: "high" for close-ups (the default), "low" for
     * scenes with several armed characters. */
    constructor(private detail: Detail = "high") {}
    async get(type: Equipment["model"], attachments: WeaponAttachments = {}): Promise<T.Group> {
        if (this.disposed) throw Error("Equipment assets disposed.");
        if (isHeldGun(type)) return this.heldGun(type, attachments);
        if (!this.models.has(type)) this.models.set(type, this.create(type));
        const source = await this.models.get(type)!;
        if (this.disposed) throw Error("Equipment assets disposed.");
        return source.clone();
    }
    /** The redesigned long gun with its fittings merged in (`held-weapons.ts`),
     * shared with every other holder of the same build; this instance keeps
     * one reference per build until it is disposed. Same contract as the
     * other models: a centred clone in inventory axes (+X muzzle, +Y up). */
    private heldGun(type: HeldGun, attachments: WeaponAttachments) {
        const key = `${type}:${heldFittings(attachments)
            .map(([slot, tier]) => `${slot}${tier}`)
            .join(",")}`;
        let held = this.held.get(key);
        if (!held) {
            const weapon = acquireHeldWeapon(type, attachments, this.detail);
            const group = new T.Group();
            group.userData.model = type;
            weapon.model.quaternion.setFromRotationMatrix(HOLDER_BASIS);
            group.add(weapon.model);
            const bounds = new T.Box3().setFromObject(group),
                center = bounds.getCenter(new T.Vector3());
            weapon.model.position.sub(center);
            group.userData.center = center.toArray();
            group.userData.muzzle = weapon.model.userData.muzzle;
            held = { group, release: weapon.release };
            this.held.set(key, held);
        }
        return held.group.clone();
    }
    /** A fitting on its own (catalog thumbnails): the redesigned upgrade model
     * in the hand socket, its origin at the mount. Clips and stocks are drawn
     * for the standard rifle; the tube stock without a model yet shows the
     * rifle's standard stock. */
    async attachment(id: string): Promise<T.Group> {
        if (this.disposed) throw Error("Equipment assets disposed.");
        const item = attachmentById(id);
        if (!item) throw Error("Unknown attachment.");
        const key = `attachment:${id}`;
        if (!this.models.has(key))
            this.models.set(key, Promise.resolve(createFitting(item.slot, item.tier)));
        const source = await this.models.get(key)!;
        if (this.disposed) throw Error("Equipment assets disposed.");
        return source.clone();
    }
    private async create(type: Equipment["model"]) {
        const group = new T.Group();
        group.userData.model = type;
        if (type === "pistol") {
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
                const gltf = await createGLTFLoader().loadAsync(
                    assetUrl(`armor/${path}.glb?v=${type === "armor" ? 7 : 10}`),
                );
                gltf.scene.traverse((o) => {
                    if (o instanceof T.Mesh) group.add(new T.Mesh(o.geometry, o.material));
                });
            }
        } else if (type === "grenade" || type === "medkit") {
            group.add(createFieldSupply(type));
        } else throw Error(`${type}: long guns come from held-weapons.`);
        const bounds = new T.Box3().setFromObject(group),
            center = bounds.getCenter(new T.Vector3());
        for (const child of group.children) child.position.sub(center);
        group.userData.center = center.toArray();
        return group;
    }
    dispose() {
        this.disposed = true;
        for (const held of this.held.values()) held.release();
        this.held.clear();
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

// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as THREE from "three";
import { initialSquad } from "@ghosts/squad/model";
import { CharacterAssets, type Character } from "@ghosts/squad/studio/character-assets";
import { EquipmentAssets } from "@ghosts/squad/studio/equipment-assets";
import { mountHandEquipment } from "@ghosts/squad/studio/held-equipment";
import { queueBuild } from "./title-build-queue";
import { loadTitleRifleIdle } from "./title-motion";

/** VEX's standard appearance, Nyx armor, and the shared MX4 rifle/hand socket.
 * One scene-owned mixer; loading or leaving the menu never starts a second RAF. */
export function createTitleOperative(parent: THREE.Group, changed: () => void) {
    const assets = new CharacterAssets();
    const equipment = new EquipmentAssets();
    const preset = initialSquad().recruits[0];
    let disposed = false;
    let character: Character | undefined;
    let rifle: THREE.Group | undefined;
    let mixer: THREE.AnimationMixer | undefined;
    let legs: {
        upper: THREE.Bone;
        lower: THREE.Bone;
        foot: THREE.Bone;
        upperRest: THREE.Quaternion;
        lowerRest: THREE.Quaternion;
        footRest: THREE.Quaternion;
    }[] = [];
    let hips: THREE.Bone | undefined;
    let hipHeight = 0;
    const rotation = new THREE.Quaternion();
    const soleVertices = new Map<THREE.Mesh, number[]>();
    const point = new THREE.Vector3();
    const toParent = new THREE.Matrix4();
    const meshToParent = new THREE.Matrix4();
    function groundSoles() {
        if (!character || !soleVertices.size) return;
        character.root.position.y = 0;
        parent.updateMatrixWorld(true);
        toParent.copy(parent.matrixWorld).invert();
        let bottom = Infinity;
        for (const [mesh, indices] of soleVertices) {
            meshToParent.multiplyMatrices(toParent, mesh.matrixWorld);
            for (const index of indices) {
                mesh.getVertexPosition(index, point).applyMatrix4(meshToParent);
                bottom = Math.min(bottom, point.y);
            }
        }
        // The group origin is the deck. Keep the supporting boot sole on that
        // plane at every gait phase, including turns; the lifted foot stays free.
        character.root.position.y = -bottom;
        character.root.updateMatrixWorld(true);
    }
    const xAxis = new THREE.Vector3(1, 0, 0);
    const ready = (async () => {
        // Character creation and the patrol clip have independent asset loads.
        const result = await Promise.allSettled([
            queueBuild(() => assets.create(preset.appearance, "nyx-mid", "rest")),
            equipment.get("rifle"),
            loadTitleRifleIdle(preset.appearance.sex),
        ]);
        const personResult = result[0];
        if (personResult.status !== "fulfilled") throw personResult.reason;
        const person = personResult.value;
        if (disposed) {
            person.dispose();
            return;
        }
        const rifleResult = result[1];
        const idleResult = result[2];
        if (rifleResult.status === "rejected" || idleResult.status === "rejected") {
            person.dispose();
            throw rifleResult.status === "rejected"
                ? rifleResult.reason
                : (idleResult as PromiseRejectedResult).reason;
        }
        character = person;
        person.setArmorColors({ primary: "#52616a", secondary: "#252e35", accent: "#66b2ba" });
        parent.add(person.root);
        rifle = rifleResult.value;
        mountHandEquipment(rifle, person.hand, person.mount);
        // Preserve the authored rifle grip and torso pose while the patrol gait
        // drives the legs. A run slowed down would slide and lift both feet.
        mixer = new THREE.AnimationMixer(person.root);
        mixer.clipAction(idleResult.value).play();
        mixer.update(0);
        hips = person.root.getObjectByName("mixamorigHips") as THREE.Bone;
        hipHeight = hips.position.y;
        legs = ["Left", "Right"].map((side) => {
            const upper = person.root.getObjectByName(`mixamorig${side}UpLeg`) as THREE.Bone;
            const lower = person.root.getObjectByName(`mixamorig${side}Leg`) as THREE.Bone;
            const foot = person.root.getObjectByName(`mixamorig${side}Foot`) as THREE.Bone;
            return {
                upper,
                lower,
                foot,
                upperRest: upper.quaternion.clone(),
                lowerRest: lower.quaternion.clone(),
                footRest: foot.quaternion.clone(),
            };
        });
        parent.updateMatrixWorld(true);
        toParent.copy(parent.matrixWorld).invert();
        let soleHeight = Infinity;
        const candidates: { mesh: THREE.Mesh; index: number; height: number }[] = [];
        person.root.traverse((object) => {
            if (!(object instanceof THREE.Mesh) || !object.geometry.attributes.position) return;
            meshToParent.multiplyMatrices(toParent, object.matrixWorld);
            for (let index = 0; index < object.geometry.attributes.position.count; index++) {
                object.getVertexPosition(index, point).applyMatrix4(meshToParent);
                soleHeight = Math.min(soleHeight, point.y);
                candidates.push({ mesh: object, index, height: point.y });
            }
        });
        const measuredHeight =
            candidates.reduce((height, vertex) => Math.max(height, vertex.height), -Infinity) -
            soleHeight;
        if (measuredHeight > 0) person.root.scale.multiplyScalar(1.8 / measuredHeight);
        for (const { mesh, index, height } of candidates) {
            if (height >= soleHeight + 0.08) continue;
            let indices = soleVertices.get(mesh);
            if (!indices) soleVertices.set(mesh, (indices = []));
            indices.push(index);
        }
        groundSoles();
        changed();
    })().catch((error) => {
        if (!disposed) console.warn("Title operative could not load", error);
    });
    return {
        ready,
        update(time: number, walking: number) {
            if (!character || !mixer || !hips) return;
            mixer.setTime(time * 0.5);
            const phase = time * 4.2;
            hips.position.y = hipHeight + (1 - Math.cos(phase * 2)) * 0.012 * walking;
            legs.forEach(({ upper, lower, foot, upperRest, lowerRest, footRest }, i) => {
                const step = Math.sin(phase + i * Math.PI);
                upper.quaternion
                    .copy(upperRest)
                    .multiply(rotation.setFromAxisAngle(xAxis, step * 0.3 * walking));
                lower.quaternion
                    .copy(lowerRest)
                    .multiply(
                        rotation.setFromAxisAngle(xAxis, Math.max(0, -step) * 0.38 * walking),
                    );
                foot.quaternion
                    .copy(footRest)
                    .multiply(rotation.setFromAxisAngle(xAxis, -step * 0.12 * walking));
            });
            groundSoles();
        },
        dispose() {
            disposed = true;
            rifle?.removeFromParent();
            if (character) {
                mixer?.stopAllAction();
                mixer?.uncacheRoot(character.root);
                character.root.removeFromParent();
                character.dispose();
            }
            assets.dispose();
            equipment.dispose();
        },
    };
}

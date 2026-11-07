// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as THREE from "three";
import { initialSquad } from "@ghosts/squad/model";
import { assetUrl, CharacterAssets, type Character } from "@ghosts/squad/studio/character-assets";
import { nativeClip } from "@ghosts/squad/motion/clips";
import { EquipmentAssets } from "@ghosts/squad/studio/equipment-assets";
import { mountHandEquipment } from "@ghosts/squad/studio/held-equipment";
import { queueBuild } from "./title-build-queue";
import { loadTitleRifleIdle } from "./title-motion";
import { SmokingEffect } from "@ghosts/squad/motion/smoking";
import { soleMinimum } from "@ghosts/squad/motion/sole-contact";

/** Foreground operatives use the street set's authored scale and one scene clock. */
export function createTitleResident(
    parent: THREE.Group,
    pose: "smoking" | "idle",
    changed: () => void,
) {
    const assets = new CharacterAssets();
    const equipment = pose === "idle" ? new EquipmentAssets() : undefined;
    let rifle: THREE.Group | undefined;
    const preset = initialSquad().recruits[pose === "smoking" ? 1 : 2];
    let disposed = false;
    let character: Character | undefined;
    let body: THREE.SkinnedMesh | undefined;
    let mixer: THREE.AnimationMixer | undefined;
    let smoking: SmokingEffect | undefined;
    let lastTime = 0;

    async function loadClip() {
        const sex = preset.appearance.sex;
        if (pose === "idle") return loadTitleRifleIdle(sex);
        const response = await fetch(assetUrl(`motions/${sex}-smoking.bin?v=3`));
        if (!response.ok) throw new Error("Title smoking motion could not load.");
        const data = await new Response(
            (await response.blob()).stream().pipeThrough(new DecompressionStream("gzip")),
        ).json();
        return nativeClip(THREE.AnimationClip.parse(data));
    }

    function update(time: number) {
        if (!character || !body || !mixer) return;
        mixer.setTime(time);
        character.root.position.y = 0;
        parent.updateMatrixWorld(true);
        // The upright scene group marks the pavement surface beneath the boots.
        character.root.position.y = parent.position.y - soleMinimum(body);
        character.root.updateMatrixWorld(true);
        smoking?.update(true, time, Math.max(0, time - lastTime));
        lastTime = time;
    }

    const ready = (async () => {
        const [personResult, clipResult, rifleResult] = await Promise.allSettled([
            queueBuild(() => assets.create(preset.appearance, "nyx-mid", "rest")),
            loadClip(),
            equipment?.get("rifle"),
        ]);
        if (personResult.status === "rejected") throw personResult.reason;
        const person = personResult.value;
        if (disposed || clipResult.status === "rejected") {
            person.dispose();
            if (!disposed && clipResult.status === "rejected") throw clipResult.reason;
            return;
        }
        if (rifleResult.status === "rejected") {
            person.dispose();
            throw rifleResult.reason;
        }
        character = person;
        person.root.name = pose === "smoking" ? "Smoking operative" : "Bench idle operative";
        person.root.scale.setScalar(3.2 / person.top);
        person.setArmorColors({ primary: "#59616a", secondary: "#29313a", accent: "#879997" });
        person.root.traverse((object) => {
            if (object instanceof THREE.SkinnedMesh && object.userData.nativePart === "skin")
                body = object;
        });
        parent.add(person.root);
        rifle = rifleResult.value;
        if (rifle) {
            rifle.name = "Bench operative MX4 rifle";
            mountHandEquipment(rifle, person.hand, person.mount);
        }
        mixer = new THREE.AnimationMixer(person.root);
        mixer.clipAction(clipResult.value).play();
        if (pose === "smoking") {
            smoking = new SmokingEffect(person.root);
            // The tiny ember uses emissive material; it needs no scene-wide light pass.
            smoking.light.visible = false;
        }
        update(0);
        changed();
    })().catch((error) => {
        if (!disposed) console.warn("Title resident could not load", error);
    });

    return {
        ready,
        update,
        dispose() {
            if (disposed) return;
            disposed = true;
            smoking?.dispose();
            rifle?.removeFromParent();
            if (character) {
                mixer?.stopAllAction();
                mixer?.uncacheRoot(character.root);
                character.root.removeFromParent();
                character.dispose();
            }
            assets.dispose();
            equipment?.dispose();
        },
    };
}

// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

// Run from app/: node --experimental-strip-types scripts/equipment-fit/build.ts
// Authoring inputs are calibrated reference holds and fitted action tracks.
// No optimizer or collision solver runs in the browser.
import fs from "node:fs";
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import * as T from "three";
import { motionSkeleton, armTo } from "@ghosts/squad/motion/clearance";
import { nativeClip } from "@ghosts/squad/motion/clips";
import { equipmentPose, type EquipmentPoses } from "@ghosts/squad/motion/equipment-poses";
import { captureArmRest, distributeArmTwist } from "./arm-twist.ts";
import { triggerGrip } from "./trigger-grip.ts";
import { supportGrip } from "./support-grip.ts";
import { mountHandEquipment } from "@ghosts/squad/studio/held-equipment";
const read = (path: string) => JSON.parse(gunzipSync(fs.readFileSync(path)).toString());
const references = JSON.parse(fs.readFileSync("scripts/equipment-fit/references.json", "utf8"));
const holds = new Set([
    "crouch_idle",
    "crouch_shooting",
    "idle",
    "run",
    "shooting",
    "stand_cover_emerge",
    "stand_cover_idle",
    "stand_cover_move",
    "rifle_idle",
    "rifle_crouch_idle",
    "rifle_run",
    "rifle_burst",
    "sniper_shot",
    "crouch_enter",
    "crouch_exit",
    "cover_return",
    "overwatch_ready",
    "hunker_down",
    "cover_peek",
    "cover_move_left",
    "idle_weight_shift",
    "take_damage",
    "heavy_hit",
    "crouch_hit",
]);
const low = new Set(["idle", "rifle_idle", "idle_weight_shift", "take_damage", "heavy_hit"]);
const arm = (name: string) => /mixamorig(?:Right|Left)(?:Shoulder|Arm|ForeArm|Hand)/.test(name);
export function changedTracks(source: T.AnimationClip, result: T.AnimationClip) {
    return result.tracks
        .filter((track) => {
            const before = source.tracks.find((t) => t.name === track.name);
            return (
                !before ||
                before.times.length !== track.times.length ||
                before.values.length !== track.values.length ||
                track.times.some((v, i) => Math.abs(v - before.times[i]) > 1e-6) ||
                track.values.some((v, i) => Math.abs(v - before.values[i]) > 1e-6)
            );
        })
        .map((track) => T.KeyframeTrack.toJSON(track.clone().optimize()));
}
for (const sex of ["female", "male"]) {
    const raw = read(`public/squad/motions/${sex}.bin`).map(
        (c: Parameters<typeof T.AnimationClip.parse>[0]) => nativeClip(T.AnimationClip.parse(c)),
    ) as T.AnimationClip[];
    const actions: EquipmentPoses = read(`scripts/equipment-fit/${sex}-actions.bin`);
    const file = fs.readFileSync(`public/squad/body/${sex}/skin.glb`),
        root = motionSkeleton(file.buffer.slice(file.byteOffset, file.byteOffset + file.length));
    const armRest = captureArmRest(root);
    const weapon = new T.Group();
    weapon.userData.center = [0, 0, 0];
    weapon.userData.model = "rifle";
    mountHandEquipment(
        weapon,
        root.getObjectByName("mixamorigRightHand") as T.Bone,
        JSON.parse(fs.readFileSync(`public/squad/body/${sex}/weapon-mount.json`, "utf8")),
    );
    const bone = (name: string) => root.getObjectByName(name)!;
    const world = (name: string) => bone(name).getWorldPosition(new T.Vector3());
    const result: EquipmentPoses = { version: 1, sources: {}, clips: {} };
    const sources = [
        `public/squad/motions/${sex}.bin`,
        `public/squad/body/${sex}/skin.glb`,
        `public/squad/body/${sex}/weapon-mount.json`,
        ...["spectre", "nyx", "nyx-mid", "nyx-heavy", "field-kit"].map(
            (id) => `public/squad/armor/${id}-${sex}.glb`,
        ),
        "../packages/squad/src/studio/long-guns.ts",
        "../packages/squad/src/studio/weapon-attachments.ts",
        "../packages/squad/src/studio/weapon-finish.ts",
        ...["rifle", "sniper", "plasma"].map((id) => `public/squad/weapons/${id}.glb`),
        "../packages/squad/src/studio/sidearm.ts",
        "scripts/equipment-fit/references.json",
        "scripts/equipment-fit/build.ts",
        "scripts/equipment-fit/support-grip.ts",
        "scripts/equipment-fit/arm-twist.ts",
        "scripts/equipment-fit/trigger-grip.ts",
        `scripts/equipment-fit/${sex}-actions.bin`,
    ];
    for (const path of sources)
        result.sources[path] = createHash("sha256").update(fs.readFileSync(path)).digest("hex");
    for (const source of raw) {
        if (!holds.has(source.name)) {
            const fitted = equipmentPose(source, actions);
            result.clips[source.name] = {
                duration: source.duration,
                tracks: changedTracks(source, fitted),
            };
            continue;
        }
        const ready = low.has(source.name),
            ref = references[sex][ready ? "ready" : "aim"];
        const changed = source.tracks
            .filter(
                (t) =>
                    t.name.endsWith(".quaternion") &&
                    (arm(t.name) || (!ready && /mixamorig(?:Spine2|Neck|Head)\./.test(t.name))),
            )
            .map((t) => bone(t.name.split(".")[0]));
        const times: number[] = [],
            values = changed.map(() => [] as number[]),
            frames = Math.ceil(source.duration * 30);
        const samplers = source.tracks.map((t) => ({
            node: bone(t.name.split(".")[0]),
            property: t.name.split(".")[1],
            sample: t.createInterpolant(),
        }));
        for (let f = 0; f <= frames; f++) {
            const time = (source.duration * f) / frames;
            for (const { node, property, sample } of samplers) {
                const v = sample.evaluate(time);
                if (property === "quaternion") node.quaternion.fromArray(v);
                else if (property === "position") node.position.fromArray(v);
                else if (property === "scale") node.scale.fromArray(v);
            }
            root.updateMatrixWorld(true);
            const axis = world("mixamorigLeftUpLeg").sub(world("mixamorigRightUpLeg"));
            const turn = new T.Quaternion()
                .setFromAxisAngle(new T.Vector3(0, 1, 0), -Math.atan2(axis.z, axis.x))
                .multiply(new T.Quaternion().fromArray(ref.heading).invert());
            changed.forEach((b) => b.quaternion.fromArray(ref.rotations[b.name].local));
            root.updateMatrixWorld(true);
            if (!ready) {
                const chest = bone("mixamorigSpine2");
                chest.quaternion.copy(
                    chest
                        .parent!.getWorldQuaternion(new T.Quaternion())
                        .invert()
                        .multiply(
                            turn.multiply(
                                new T.Quaternion().fromArray(ref.rotations[chest.name].world),
                            ),
                        ),
                );
                chest.updateMatrixWorld(true);
            }
            if (source.name === "rifle_idle") {
                // Tuck the ready hold toward the carrier as one rigid grip.
                // Move both wrists together so the stock and support hand agree.
                const tuck = new T.Vector3(
                    sex === "female" ? 0.08 : 0,
                    sex === "female" ? 0.05 : 0.025,
                    -0.06,
                ).applyQuaternion(bone("mixamorigSpine2").getWorldQuaternion(new T.Quaternion()));
                const goals = ["Right", "Left"].map((side) =>
                    world(`mixamorig${side}Hand`).add(tuck),
                );
                ["Right", "Left"].forEach((side, i) =>
                    armTo(
                        bone(`mixamorig${side}Shoulder`),
                        bone(`mixamorig${side}Arm`),
                        bone(`mixamorig${side}ForeArm`),
                        bone(`mixamorig${side}Hand`),
                        goals[i],
                    ),
                );
            }
            triggerGrip(root, weapon, sex, /shoot|shot|burst/.test(source.name));
            supportGrip(root, weapon, sex);
            distributeArmTwist(root, "Left", armRest);
            distributeArmTwist(root, "Right", armRest);
            times.push(time);
            changed.forEach((b, i) => b.quaternion.toArray(values[i], values[i].length));
        }
        result.clips[source.name] = {
            duration: source.duration,
            tracks: changed.map((b, i) =>
                T.KeyframeTrack.toJSON(
                    new T.QuaternionKeyframeTrack(
                        b.name + ".quaternion",
                        times,
                        values[i],
                    ).optimize(),
                ),
            ),
        };
    }
    // IK matrix decomposition can accumulate quaternion length error; normalize
    // authored rotations before serializing, rather than skewing held geometry.
    for (const pose of Object.values(result.clips))
        for (const track of pose.tracks) {
            if (!track.name.endsWith(".quaternion")) continue;
            for (let i = 0; i < track.values.length; i += 4)
                new T.Quaternion().fromArray(track.values, i).normalize().toArray(track.values, i);
        }
    const output = `public/squad/motions/${sex}-equipment.bin`,
        packed = gzipSync(JSON.stringify(result), { level: 9 });
    fs.writeFileSync(output, packed);
    console.log(`${output}: ${Object.keys(result.clips).length} poses, ${packed.length} bytes`);
}

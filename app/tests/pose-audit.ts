import fs from "node:fs";
import { gunzipSync } from "node:zlib";
import * as T from "three";
import { skinMeshes, posedSurface, weaponEdges } from "./gear-collision.ts";
import { motionSkeleton, clearEquipment } from "@ghosts/squad/motion/clearance";
import { nativeClip } from "@ghosts/squad/motion/clips";
import { equipmentPose, type EquipmentPoses } from "@ghosts/squad/motion/equipment-poses";
import { mountHandEquipment } from "@ghosts/squad/studio/held-equipment";
import { createLongGun } from "@ghosts/squad/studio/long-guns";
import { createSidearm } from "@ghosts/squad/studio/sidearm";
import { WeaponCarry } from "@ghosts/squad/motion/weapon-carry";
const sex = process.env.SEX ?? "female",
    fps = Number(process.env.FPS ?? 30),
    results = [];
const file = fs.readFileSync(`public/squad/body/${sex}/skin.glb`),
    root = motionSkeleton(file.buffer.slice(file.byteOffset, file.byteOffset + file.length));
const allSets = [
    ["body", skinMeshes(`public/squad/body/${sex}/skin.glb`, root)],
    ...["spectre", "nyx", "nyx-mid", "nyx-heavy", "field-kit"].map((k) => [
        k,
        skinMeshes(`public/squad/armor/${k}-${sex}.glb`, root),
    ]),
] as [string, T.SkinnedMesh[]][];
const sets = process.env.ONLY_SET ? allSets.filter(([name])=>name===process.env.ONLY_SET) : allSets;
if(!sets.length)throw Error("Unknown collision set");
const mount = JSON.parse(fs.readFileSync(`public/squad/body/${sex}/weapon-mount.json`, "utf8"));
const kind = process.env.WEAPON === "rifle" ? "rifle" : process.env.WEAPON === "plasma" ? "plasma" : "sniper";
const equipment = [kind, "pistol"].map((type) => {
    const gun = type === "pistol" ? createSidearm() : createLongGun(kind, process.env.ATTACHMENTS === "max" ? { clip: "clip-3", stock: "stock-3", laser: "laser-3", scope: "scope-3" } : {}),
        group = new T.Group();
    gun.quaternion.setFromRotationMatrix(
        new T.Matrix4().makeBasis(
            new T.Vector3(0, 0, -1),
            new T.Vector3(1, 0, 0),
            new T.Vector3(0, -1, 0),
        ),
    );
    group.add(gun);
    group.userData.center = [0, 0, 0];
    group.userData.model = type;
    mountHandEquipment(group, root.getObjectByName("mixamorigRightHand") as T.Bone, mount);
    const carry = new WeaponCarry(group, root.getObjectByName("mixamorigLeftHand")!);
    root.updateMatrixWorld(true);
    const edges = weaponEdges(gun).map(
        (e) => e.map((p) => gun.worldToLocal(p.clone())) as [T.Vector3, T.Vector3],
    );
    return { gun, group, carry, edges, type };
});
const fitted: EquipmentPoses | undefined = process.env.FIT
    ? undefined
    : JSON.parse(
          gunzipSync(fs.readFileSync(`public/squad/motions/${sex}-equipment.bin`)).toString(),
      );
const clips = JSON.parse(
    gunzipSync(fs.readFileSync(process.env.FIT ?? `public/squad/motions/${sex}.bin`)).toString(),
).map((c: Parameters<typeof T.AnimationClip.parse>[0]) =>
    nativeClip(T.AnimationClip.parse(c)),
) as T.AnimationClip[];
const rest: [T.Object3D, T.Vector3, T.Quaternion, T.Vector3][] = [];
root.traverse((o) => rest.push([o, o.position.clone(), o.quaternion.clone(), o.scale.clone()]));
for (const raw of clips) {
    const original = fitted ? equipmentPose(raw, fitted) : raw;
    if (process.env.CLIP && !original.name.match(process.env.CLIP)) continue;
    equipment.forEach((e) => e.carry.update(false));
    for (const [o, p, q, s] of rest) {
        o.position.copy(p);
        o.quaternion.copy(q);
        o.scale.copy(s);
    }
    root.updateMatrixWorld(true);
    const { gun, carry, edges, type } = equipment[original.name.startsWith("pistol_") ? 1 : 0];
    const clip = process.env.CORRECT ? clearEquipment(original, root, mount) : original;
    for (const track of clip.tracks) {
        const size = track.name.endsWith(".quaternion") ? 4 : 3;
        if (
            track.values.length !== track.times.length * size ||
            !Array.from(track.values).every(Number.isFinite)
        )
            throw Error(`Invalid track ${clip.name}/${track.name}`);
    }
    if (clip.name === "toss_grenade") carry.prepare(clip, root);
    const samplers = clip.tracks.map((t) => ({
        node: root.getObjectByName(t.name.split(".")[0])!,
        property: t.name.split(".")[1],
        sample: t.createInterpolant(),
    }));
    const count = Math.max(2, Math.ceil(clip.duration * fps));
    let worst: {
        count: number;
        time: number;
        regions: Record<string, number>;
        points: number[][];
        local: number[][];
    } = { count: 0, time: 0, regions: {}, points: [], local: [] };
    const setsWorst: Record<string, number> = {};
    for (let f = 0; f <= count; f++) {
        const time = (clip.duration * f) / count;
        for (const { node, property, sample } of samplers) {
            const value = sample.evaluate(time);
            if (property === "quaternion") node.quaternion.fromArray(value);
            else if (property === "position") node.position.fromArray(value);
            else if (property === "scale") node.scale.fromArray(value);
        }
        root.updateMatrixWorld(true);
        carry.update(original.name === "toss_grenade");
        root.updateMatrixWorld(true);
        if (!gun.matrixWorld.elements.every(Number.isFinite))
            throw Error(`Non-finite pose: ${clip.name}@${time}`);
        const world = edges.map(
            (e) => e.map((p) => p.clone().applyMatrix4(gun.matrixWorld)) as [T.Vector3, T.Vector3],
        );
        const landmarks = (
            type === "pistol"
                ? [[0, 0, 0]]
                : [
                      [0, -0.29, -0.045],
                      [0, -0.045, -0.046],
                      [0, 0.18, -0.046],
                      [0, 0.02, 0.1],
                      [0, 0.4, -0.046],
                      ...(type === "sniper" ? [[0, 0.05, -0.132]] : []),
                  ]
        ).map((p) => new T.Vector3(...p).applyMatrix4(gun.matrixWorld));
        let total = 0;
        const regions: Record<string, number> = {},
            points: number[][] = [];
        for (const [label, meshes] of sets) {
            const surface = posedSurface(meshes, label === "body");
            let hits = 0;
            for (const [a, b] of world)
                for (const hit of surface.segment(a, b)) {
                    hits++;
                    const key = label + "/" + hit.region.replace("mixamorig", "");
                    regions[key] = (regions[key] ?? 0) + 1;
                    if (points.length < 20) points.push(hit.point);
                }
            for (const point of landmarks) {
                const hit = surface(point);
                if (hit) {
                    hits++;
                    const key = label + "/" + hit.region.replace("mixamorig", "");
                    regions[key] = (regions[key] ?? 0) + 1;
                    if (points.length < 20) points.push(hit.point);
                }
            }
            setsWorst[label] = Math.max(setsWorst[label] ?? 0, hits);
            total += hits;
        }
        if (total > worst.count)
            worst = {
                count: total,
                time,
                regions,
                points,
                local: points.map((p) => gun.worldToLocal(new T.Vector3(...p)).toArray()),
            };
    }
    const result = {
        sex,
        weapon: type,
        name: clip.name,
        frames: count + 1,
        sets: setsWorst,
        worst,
    };
    results.push(result);
    console.log(JSON.stringify(result));
    fs.writeFileSync(
        process.env.REPORT ?? `/tmp/ghosts-${sex}-pose-audit.json`,
        JSON.stringify(results, null, 2),
    );
}
if (process.env.STRICT && results.some((r) => r.worst.count > 0)) process.exitCode = 1;

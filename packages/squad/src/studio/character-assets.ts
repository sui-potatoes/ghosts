// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import { equipmentPose, loadEquipmentPoses } from "../motion/equipment-poses";
import { nativeClip } from "../motion/clips";
import { paintArmor } from "./armor-materials";
import { officeIdle } from "./office-worker";
import { BodyDeformation } from "../appearance/body-shape";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { weights } from "../appearance/editor-state.js";
import { frontSurface, shapeBrow } from "../appearance/brow-shape.js";
import { installBlush, updateBlush } from "../appearance/skin-blush.js";
import { installScars, updateScars } from "../appearance/skin-scars.js";
import { installBodySuit, remapNativeWeights } from "../appearance/native-body-binding.js";
import { createEyewear, lensOpacity } from "../appearance/eyewear.js";
import { nativeTattoo } from "../appearance/mpfb-tattoo.js";
import { breather } from "./breather";
import type { Appearance, ArmorColors, Sex } from "../types";

export const assetUrl = (path: string) => `${import.meta.env.BASE_URL}squad/${path}`;
export type CharacterLook = "operative" | "office-worker";
interface Target {
    offset: number;
    count: number;
}
interface PartMeta {
    primitives: { vertices: number; targets: Record<string, Target> }[];
}
interface Manifest {
    top: number;
    parts: Record<string, PartMeta>;
}
interface Part {
    gltf: GLTF;
    meta: PartMeta;
    packed: ArrayBuffer;
    top: number;
}
interface WeaponMount {
    position: number[];
    quaternion: number[];
    scale: number[];
    correction: number[];
    translation: number[];
    rifleTranslation?: number[];
}
export interface Character {
    root: T.Group;
    eye: T.Vector3;
    top: number;
    hand: T.Bone;
    mount: WeaponMount;
    idleClip: T.AnimationClip;
    heightScale: number;
    setArmorColors(colors: ArmorColors): void;
    /**
     * Apply a look that differs from the built one only in surface style (see
     * `STYLE`) to the existing materials. False when anything else changed:
     * the caller builds a new character instead.
     */
    restyle(next: Appearance): boolean;
    dispose(): void;
}
/**
 * Appearance fields that only colour or tint existing materials. Editing
 * them restyles a built character in place; every other field (face and body
 * shape, hair and brow styles, eyewear type, tattoos) changes geometry and
 * needs a rebuild.
 */
const STYLE = new Set<keyof Appearance>([
    "name",
    "skinTint",
    "warmth",
    "roughness",
    "blushColor",
    "blushAmount",
    "blushPlacement",
    "blushSpread",
    "scar",
    "scarPlace",
    "scarAmount",
    "hairColor",
    "browColor",
    "browDensity",
    "glassesColor",
    "lensColor",
    "lensTint",
]);
function paintSkin(m: T.MeshStandardMaterial, s: Appearance) {
    m.color
        .set(s.skinTint)
        .multiply(
            new T.Color().setRGB(
                1 - Math.max(0, -s.warmth) * 0.06,
                1 - Math.abs(s.warmth) * 0.035,
                1 - Math.max(0, s.warmth) * 0.12,
            ),
        );
    m.roughness = s.roughness;
}
async function json<T>(url: string): Promise<T> {
    const response = await fetch(url);
    if (!response.ok) throw Error(`Asset unavailable (${response.status}).`);
    return response.json();
}
function meshes(root: T.Object3D) {
    const result: T.Mesh[] = [];
    root.traverse((o) => {
        if (o instanceof T.Mesh) result.push(o);
    });
    return result;
}
function material(mesh: T.Mesh) {
    if (Array.isArray(mesh.material)) throw Error("Expected single character material.");
    return mesh.material as T.MeshStandardMaterial;
}
function hideBodyInsideBoots(body: T.SkinnedMesh) {
    // Boots are permanent base clothing. Keep the body at the cuff, but do not
    // draw enclosed feet: independent skin interpolation can expose their heel
    // triangles through an otherwise fitted upper in the frozen idle pose.
    const geometry = body.geometry,
        position = geometry.attributes.position,
        joints = geometry.attributes.skinIndex,
        skinWeight = geometry.attributes.skinWeight;
    body.updateWorldMatrix(true, false);
    const footHeights = new Map<string, number>();
    for (const side of ["Left", "Right"]) {
        const foot = body.skeleton.bones.find((b) => b.name.endsWith(`${side}Foot`))!;
        const point = body.worldToLocal(foot.getWorldPosition(new T.Vector3()));
        footHeights.set(side, point.y + 0.17);
    }
    const covered = Array.from({ length: position.count }, (_, i) => {
        const side = position.getX(i) > 0 ? "Left" : "Right";
        if (position.getY(i) >= footHeights.get(side)!) return false;
        let influence = 0;
        for (let k = 0; k < 4; k++) {
            const name = body.skeleton.bones[joints.getComponent(i, k)].name;
            if (["Foot", "ToeBase", "Leg"].some((part) => name.endsWith(`${side}${part}`)))
                influence += skinWeight.getComponent(i, k);
        }
        return influence > 0.8;
    });
    const index = geometry.index!,
        visible = [];
    for (let i = 0; i < index.count; i += 3) {
        const triangle = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
        if (!triangle.every((vertex) => covered[vertex])) visible.push(...triangle);
    }
    geometry.setIndex(visible);
}
/** Vertices sharing a rest position, per source geometry: the same for every build. */
const seams = new WeakMap<T.BufferGeometry, number[][]>();
function coincident(source: T.BufferGeometry, base: Float32Array) {
    let result = seams.get(source);
    if (!result) {
        const groups = new Map<string, number[]>();
        for (let i = 0; i < base.length; i += 3) {
            const key = [base[i], base[i + 1], base[i + 2]]
                .map((v) => Math.round(v * 1e6))
                .join(",");
            const list = groups.get(key) ?? [];
            list.push(i);
            groups.set(key, list);
        }
        result = [...groups.values()];
        seams.set(source, result);
    }
    return result;
}
function smoothNormals(g: T.BufferGeometry, base: Float32Array, source: T.BufferGeometry) {
    const p = g.attributes.position.array,
        index = g.index!.array,
        sums = new Float32Array(p.length);
    const a = new T.Vector3(),
        b = new T.Vector3(),
        normal = new T.Vector3();
    for (let i = 0; i < index.length; i += 3) {
        const ia = index[i] * 3,
            ib = index[i + 1] * 3,
            ic = index[i + 2] * 3;
        a.set(p[ib] - p[ia], p[ib + 1] - p[ia + 1], p[ib + 2] - p[ia + 2]);
        b.set(p[ic] - p[ia], p[ic + 1] - p[ia + 1], p[ic + 2] - p[ia + 2]);
        normal.crossVectors(a, b);
        for (const k of [ia, ib, ic]) {
            sums[k] += normal.x;
            sums[k + 1] += normal.y;
            sums[k + 2] += normal.z;
        }
    }
    const normals = new Float32Array(p.length);
    for (const group of coincident(source, base)) {
        normal.set(0, 0, 0);
        for (const i of group) normal.add(a.fromArray(sums, i));
        normal.normalize();
        for (const i of group) normal.toArray(normals, i);
    }
    g.setAttribute("normal", new T.BufferAttribute(normals, 3));
}
function deform(
    mesh: T.Mesh,
    meta: PartMeta["primitives"][number],
    packed: ArrayBuffer,
    w: Record<string, number>,
    skin: boolean,
) {
    const original = mesh.geometry,
        geometry = (mesh.geometry = original.clone());
    mesh.material = material(mesh).clone();
    const source = geometry.attributes.position,
        base = new Float32Array(source.count * 3);
    for (let i = 0; i < source.count; i++) {
        base[i * 3] = source.getX(i);
        base[i * 3 + 1] = source.getY(i);
        base[i * 3 + 2] = source.getZ(i);
    }
    const p = base.slice();
    for (const [name, weight] of Object.entries(w)) {
        const target = meta.targets[name];
        if (!target) continue;
        const view = new DataView(packed, target.offset, target.count * 10);
        for (let i = 0; i < target.count; i++) {
            const index = view.getUint32(i * 10, true) * 3;
            for (let j = 0; j < 3; j++)
                p[index + j] += (view.getInt16(i * 10 + 4 + j * 2, true) / 1e6) * weight;
        }
    }
    geometry.setAttribute("position", new T.BufferAttribute(p, 3));
    mesh.userData = { base, original: mesh.material };
    if (skin) smoothNormals(geometry, base, original);
    else geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    mesh.frustumCulled = false;
}
/**
 * Decoded assets shared by every `CharacterAssets` for the session: the
 * squad stage, the armory's thumbnails, the title scene and the encounter
 * each used to download and decode the same bodies, parts, outfits and
 * textures on their own. Characters only ever use clones (geometry and
 * materials are copied before they change), so the sources stay intact and
 * are never disposed; a failed load is forgotten so the next request retries.
 */
const shared = {
    loader: new GLTFLoader(),
    // Bitmaps decode off the main thread; a plain image decodes on its first draw.
    bitmapLoader:
        typeof createImageBitmap === "function"
            ? new T.ImageBitmapLoader().setOptions({ premultiplyAlpha: "none" })
            : null,
    textureLoader: new T.TextureLoader(),
    parts: new Map<string, Promise<Part>>(),
    manifests: new Map<string, Promise<Manifest>>(),
    textures: new Map<string, Promise<T.Texture>>(),
    armor: new Map<string, Promise<GLTF>>(),
    fieldKit: new Map<Sex, Promise<GLTF>>(),
    mounts: new Map<Sex, Promise<WeaponMount>>(),
    poses: new Map<string, Promise<T.AnimationClip>>(),
};
function remember<K, V>(map: Map<K, Promise<V>>, key: K, load: () => Promise<V>): Promise<V> {
    let hit = map.get(key);
    if (!hit) {
        const promise = load();
        map.set(key, promise);
        promise.catch(() => {
            if (map.get(key) === promise) map.delete(key);
        });
        hit = promise;
    }
    return hit;
}
export class CharacterAssets {
    private disposed = false;
    private getPart(sex: Sex, key: string): Promise<Part> {
        const root = key === "skin" ? "body" : "editor",
            id = `${root}/${sex}/${key}`;
        return remember(shared.parts, id, async () => {
            const [gltf, manifest, response] = await Promise.all([
                shared.loader.loadAsync(assetUrl(`${id}.glb`)),
                remember(shared.manifests, `${root}/${sex}`, () =>
                    json<Manifest>(assetUrl(`${root}/${sex}/manifest.json`)),
                ),
                fetch(assetUrl(`${id}.morphs.bin`)),
            ]);
            if (!response.ok) throw Error("Unable to load character morphs.");
            const blob = await response.blob();
            const packed = await new Response(
                blob.stream().pipeThrough(new DecompressionStream("gzip")),
            ).arrayBuffer();
            return {
                gltf,
                meta: manifest.parts[key],
                top: manifest.top,
                packed,
            };
        });
    }
    private texture(path: string) {
        return remember(shared.textures, path, () =>
            (shared.bitmapLoader
                ? shared.bitmapLoader.loadAsync(assetUrl(path)).then((b) => new T.Texture(b))
                : shared.textureLoader.loadAsync(assetUrl(path))
            ).then((t) => {
                t.needsUpdate = true;
                t.flipY = false;
                t.colorSpace = T.SRGBColorSpace;
                t.anisotropy = 2;
                return t;
            }),
        );
    }
    private pose(sex: Sex, model: string) {
        const key = `${sex}/${model === "sniper" ? "sniper" : "rifle"}`;
        return remember(shared.poses, key, () =>
            Promise.all([
                json<Parameters<typeof T.AnimationClip.parse>[0]>(
                    assetUrl(`body/${sex}/idle.json`),
                ),
                loadEquipmentPoses(sex, model),
            ]).then(([data, poses]) =>
                equipmentPose(nativeClip(T.AnimationClip.parse(data)), poses),
            ),
        );
    }
    private armorAsset(id: string, sex: Sex) {
        const key = `${id}-${sex}`;
        return remember(shared.armor, key, () =>
            shared.loader.loadAsync(assetUrl(`armor/${key}.glb?v=${id === "spectre" ? 8 : 11}`)),
        );
    }
    async create(
        s: Appearance,
        armorId: string | null,
        poseMode: "idle" | "rest" = "idle",
        look: CharacterLook = "operative",
        weaponModel = "rifle",
    ): Promise<Character> {
        if (this.disposed) throw Error("Studio closed.");
        const office = look === "office-worker";
        const keys = ["skin", "eyes", "lashes", s.brows, s.hair].filter((k) => k !== "none");
        const [parts, skinTexture, eyeTexture, pose, mount, kit] = await Promise.all([
            Promise.all(keys.map((key) => this.getPart(s.sex, key))),
            this.texture(`editor/textures/${s.skin}_${s.sex}.webp`),
            this.texture(`editor/textures/eye-${s.eyes}.webp`),
            office ? Promise.resolve(null) : this.pose(s.sex, weaponModel),
            remember(shared.mounts, s.sex, () =>
                json<WeaponMount>(assetUrl(`body/${s.sex}/weapon-mount.json?v=3`)),
            ),
            office
                ? this.armorAsset("office-worker", s.sex)
                : remember(shared.fieldKit, s.sex, () =>
                      shared.loader.loadAsync(assetUrl(`armor/field-kit-${s.sex}.glb?v=10`)),
                  ),
        ]);
        if (this.disposed) throw Error("Studio closed.");
        // A build is a few hundred milliseconds of geometry work; pausing
        // between its steps keeps the screen responding while it runs.
        const pause = async () => {
            await breather();
            if (this.disposed) throw Error("Studio closed.");
        };
        const root = clone(parts[0].gltf.scene) as T.Group,
            body = meshes(root)[0] as T.SkinnedMesh;
        const w = weights(s);
        deform(body, parts[0].meta.primitives[0], parts[0].packed, w, true);
        body.userData.nativePart = "skin";
        body.userData.nativeTop = parts[0].top;
        const top = parts[0].top,
            m = material(body);
        m.map = skinTexture;
        paintSkin(m, s);
        /** The look the geometry was built for; restyles move only its style fields. */
        let built = s;
        m.metalness = 0;
        installBlush(body, top);
        updateBlush(body, s);
        installScars(body, top);
        updateScars(body, s);
        await pause();
        if (!office) installBodySuit(body, top, body.skeleton, armorId?.startsWith("nyx") ?? false);
        await pause();
        const headIndex = body.skeleton.bones.findIndex((b) => b.name.endsWith("Head"));
        function attach(g: T.BufferGeometry, mat: T.Material, nativeSkeleton?: T.Skeleton) {
            if (nativeSkeleton) remapNativeWeights(g, nativeSkeleton, body.skeleton, true);
            else {
                const count = g.attributes.position.count,
                    joints = new Uint16Array(count * 4),
                    values = new Float32Array(count * 4);
                for (let i = 0; i < count; i++) {
                    joints[i * 4] = headIndex;
                    values[i * 4] = 1;
                }
                g.setAttribute("skinIndex", new T.Uint16BufferAttribute(joints, 4));
                g.setAttribute("skinWeight", new T.Float32BufferAttribute(values, 4));
            }
            const mesh = new T.SkinnedMesh(g, mat);
            mesh.bind(body.skeleton, body.bindMatrix);
            mesh.frustumCulled = false;
            root.add(mesh);
            return mesh;
        }
        const surface = frontSurface(
            body.geometry.attributes.position.array,
            body.geometry.index!.array,
        );
        let eyes: T.SkinnedMesh | undefined;
        // Materials a restyle recolours in place.
        const hairMaterials: T.MeshStandardMaterial[] = [],
            browMaterials: T.MeshStandardMaterial[] = [],
            eyewear: Record<string, T.MeshStandardMaterial> = {};
        for (let i = 1; i < parts.length; i++) {
            await pause();
            for (const [j, source] of meshes(parts[i].gltf.scene).entries()) {
                const mesh = source.clone();
                deform(mesh, parts[i].meta.primitives[j], parts[i].packed, w, false);
                const mat = material(mesh),
                    key = keys[i];
                mat.metalness = 0;
                mat.roughness = key === "eyes" ? 0.36 : 0.8;
                if (key === "eyes") {
                    mat.map = eyeTexture;
                    mat.color.set("#ffffff");
                } else {
                    mat.color.set(
                        key === "lashes"
                            ? "#27201d"
                            : key.startsWith("brow")
                              ? s.browColor
                              : s.hairColor,
                    );
                    mat.alphaTest = 0.15;
                    mat.alphaToCoverage = true;
                }
                if (key.startsWith("brow")) browMaterials.push(mat);
                else if (key !== "eyes" && key !== "lashes") hairMaterials.push(mat);
                if (key.startsWith("brow")) {
                    const positions = mesh.geometry.attributes.position;
                    positions.array.set(shapeBrow(positions.array as Float32Array, s, surface));
                    mesh.geometry.computeVertexNormals();
                    mat.opacity = s.browDensity;
                }
                const attached = attach(mesh.geometry, mat);
                attached.userData.nativePart = key;
                if (key === "eyes") eyes = attached;
            }
        }
        await pause();
        if (eyes) {
            for (const part of createEyewear(s, body.geometry, eyes.geometry)) {
                attach(part.g, part.material).userData.nativePart = "eyewear";
                eyewear[part.key] = part.material as T.MeshStandardMaterial;
            }
            const tattoo = nativeTattoo(s, body.geometry, top, eyes.geometry);
            if (tattoo) {
                const accessory = attach(tattoo.g, tattoo.material);
                accessory.userData.ownTexture = true;
                accessory.userData.nativePart = "tattoo";
            }
        }
        // Civilian clothing replaces the entire field kit, including its boots and belt.
        const kitMeshes: T.SkinnedMesh[] = [];
        for (const source of meshes(kit.scene)) {
            await pause();
            const skin = source as T.SkinnedMesh;
            const attached = attach(skin.geometry.clone(), material(skin).clone(), skin.skeleton);
            attached.userData.nativePart = office ? "office-worker" : "field-kit";
            kitMeshes.push(attached);
        }
        await pause();
        if (office) {
            // Keep the original vertex buffer and weights for contact sampling and morphs;
            // omit only enclosed triangles to prevent skin showing through moving cloth.
            body.updateWorldMatrix(true, false);
            const neck =
                body.worldToLocal(
                    body.skeleton.bones
                        .find((b) => b.name.endsWith("Neck"))!
                        .getWorldPosition(new T.Vector3()),
                ).y + 0.002;
            const g = body.geometry,
                p = g.attributes.position,
                joints = g.attributes.skinIndex,
                skinWeights = g.attributes.skinWeight;
            const exposed = Array.from({ length: p.count }, (_, i) => {
                let hand = 0;
                for (let k = 0; k < 4; k++)
                    if (body.skeleton.bones[joints.getComponent(i, k)].name.includes("Hand"))
                        hand += skinWeights.getComponent(i, k);
                return p.getY(i) > neck || hand > 0.18;
            });
            const visible: number[] = [],
                index = g.index!;
            for (let i = 0; i < index.count; i += 3) {
                const triangle = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
                if (triangle.some((v) => exposed[v])) visible.push(...triangle);
            }
            g.setIndex(visible);
        } else hideBodyInsideBoots(body);
        const armorMaterials: T.MeshStandardMaterial[] = [];
        if (!office && armorId && ["spectre", "nyx", "nyx-mid", "nyx-heavy"].includes(armorId)) {
            const armor = await this.armorAsset(armorId, s.sex);
            for (const source of meshes(armor.scene)) {
                await pause();
                const skin = source as T.SkinnedMesh;
                const armorMaterial = material(skin).clone();
                armorMaterials.push(armorMaterial);
                attach(skin.geometry.clone(), armorMaterial, skin.skeleton).userData.nativePart =
                    "armor";
            }
        }
        await pause();
        const physique = new BodyDeformation(body, s.body);
        for (const mesh of meshes(root)) physique.geometry(mesh.geometry);
        await pause();
        // Office idle is authored in the original rest coordinates before stature scaling.
        const idleClip = office ? officeIdle(root) : pose!;
        root.scale.multiplyScalar(physique.heightScale);
        const mixer = new T.AnimationMixer(root);
        if (poseMode === "idle") {
            mixer.clipAction(idleClip).play();
            mixer.setTime(0.8);
        }
        root.updateMatrixWorld(true);
        body.skeleton.update();
        // Posed bounds skin every vertex; each mesh's is kept, so take them one at a time.
        for (const mesh of [body, ...kitMeshes]) {
            mesh.computeBoundingBox();
            await pause();
        }
        const bounds = new T.Box3().setFromObject(body);
        // Ground the sole, not the bare foot hidden inside it.
        for (const mesh of kitMeshes) bounds.expandByObject(mesh);
        if (poseMode === "idle") root.position.y -= bounds.min.y;
        root.updateMatrixWorld(true);
        body.skeleton.update();
        const eye = eyes
            ? new T.Box3().setFromObject(eyes).getCenter(new T.Vector3())
            : new T.Vector3(0, top - 0.12, 0.08);
        mixer.timeScale = 0;
        return {
            root,
            eye,
            top: bounds.max.y - bounds.min.y,
            hand: body.skeleton.bones.find((b) => b.name.endsWith("RightHand"))!,
            mount,
            idleClip,
            heightScale: physique.heightScale,
            restyle(next) {
                const fields = new Set([...Object.keys(built), ...Object.keys(next)]);
                for (const field of fields as Set<keyof Appearance>)
                    if (
                        !STYLE.has(field) &&
                        JSON.stringify(built[field]) !== JSON.stringify(next[field])
                    )
                        return false;
                paintSkin(m, next);
                updateBlush(body, next);
                updateScars(body, next);
                for (const mat of hairMaterials) mat.color.set(next.hairColor);
                for (const mat of browMaterials) {
                    mat.color.set(next.browColor);
                    mat.opacity = next.browDensity;
                }
                eyewear["glasses-frame"]?.color.set(next.glassesColor);
                const lens = eyewear["glasses-lens"];
                if (lens) {
                    lens.color.set(next.lensColor);
                    lens.opacity = lensOpacity(next.lensTint);
                }
                built = next;
                return true;
            },
            setArmorColors(colors) {
                paintArmor(armorMaterials, colors);
            },
            dispose() {
                mixer.stopAllAction();
                mixer.uncacheRoot(root);
                root.traverse((o) => {
                    if (o instanceof T.Mesh) {
                        o.geometry.dispose();
                        for (const mat of Array.isArray(o.material) ? o.material : [o.material]) {
                            if (o.userData.ownTexture)
                                (mat as T.MeshStandardMaterial).map?.dispose();
                            mat.dispose();
                        }
                    }
                });
                body.skeleton.dispose();
            },
        };
    }
    /** Stops this owner's pending builds; the shared sources stay for the next owner. */
    dispose() {
        this.disposed = true;
    }
}

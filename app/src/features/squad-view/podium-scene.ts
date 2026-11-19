// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * A row of podiums in one scene: the squad as figurines on lit plinths, for
 * the match's squad selection and the `/ui-sample` deploy and debrief. One
 * renderer, one camera, one character per podium built with the game's own
 * `CharacterAssets` (shared parts cache) as a "figurine" (baked pose, merged
 * draws; see `CreateOptions`) and its rifle from `EquipmentAssets` at the
 * field units' low detail, with the recruit's finish, mounted in the hand the
 * way the recruit studio does it.
 *
 * Renders on demand: a frame per change, and a short run of frames only while
 * a transition eases (a figure stepping forward, a light going out); a still
 * scene draws nothing. Loaded on its own chunk with three.js.
 */

import { ATTACHMENTS, itemById } from "@ghosts/squad/catalog";
import { CharacterAssets, type Character } from "@ghosts/squad/studio/character-assets";
import { EquipmentAssets } from "@ghosts/squad/studio/equipment-assets";
import { mountHandEquipment } from "@ghosts/squad/studio/held-equipment";
import type { Recruit } from "@ghosts/squad/types";
import { MeshoptSimplifier } from "meshoptimizer";
import * as T from "three";

/** Podiums when the caller does not say: a match deploys three a side on Black Rain. */
export const PODIUMS = 3;
const SPACING = 1.5;
const PLINTH_TOP = 0.32;

export type Anchor = { x: number; top: number; base: number; width: number };

/** The figurine parts worth simplifying: closed surfaces (no hair cards, no eyes). */
const REDUCED = new Set(["skin", "field-kit", "armor"]);
/** The most a reduced mesh may deviate, relative to its size: well under a pixel on a podium. */
const REDUCE_ERROR = 0.002;
/** Keep at most this share of a reduced mesh's triangles. */
const REDUCE_TO = 0.35;

/**
 * A figurine's closed surfaces with fewer triangles: the index buffer is
 * simplified within `REDUCE_ERROR` (meshoptimizer), every vertex and its
 * attributes stay, borders and UV seams are locked. Only for still, baked
 * figures (`detail: "figurine"`): a skinned mesh is left as it is.
 */
async function reduce(root: T.Object3D) {
    await MeshoptSimplifier.ready;
    root.traverse((o) => {
        if (!(o instanceof T.Mesh) || o instanceof T.SkinnedMesh) return;
        if (!REDUCED.has(o.userData.nativePart)) return;
        const g = o.geometry as T.BufferGeometry;
        const position = g.attributes.position;
        if (!g.index || !(position.array instanceof Float32Array) || position.itemSize !== 3)
            return;
        const indices = Uint32Array.from(g.index.array);
        const target = Math.floor((indices.length * REDUCE_TO) / 3) * 3;
        const [reduced] = MeshoptSimplifier.simplify(
            indices,
            position.array,
            3,
            target,
            REDUCE_ERROR,
            ["LockBorder"],
        );
        if (reduced.length >= indices.length) return;
        g.setIndex(new T.BufferAttribute(reduced, 1));
    });
}

export interface PodiumScene {
    /** Who stands on each podium (null: a bare plinth). Rebuilds only what changed. */
    setFigures(figures: (Recruit | null)[]): Promise<void>;
    /** The podium under the cursor steps forward and lights up; the rest recede. */
    focus(index: number | null): void;
    /** A podium's light: off leaves its figure a dark silhouette. */
    setLit(index: number, lit: boolean, instant?: boolean): void;
    /** A built figure stays out of the scene until shown (default shown): a podium waiting for its recruit. */
    setShown(index: number, shown: boolean): void;
    /** Inspect: an unlit podium gets a low glance of light, enough to read the silhouette. */
    inspect(index: number | null): void;
    /** Turn the focused figure (Inspect). */
    turn(angle: number): void;
    /** Where each podium sits on the canvas (CSS px), for the plates and hit boxes. */
    anchors(): Anchor[];
    /** The last frame's cost. */
    stats(): { triangles: number; calls: number; frames: number };
    /** What the figures on the podiums are made of, by part (for measuring). */
    breakdown(): Record<string, { meshes: number; triangles: number; skinned: number }>;
    dispose(): void;
}

type Slot = {
    group: T.Group;
    plinth: T.Mesh;
    rim: T.Mesh;
    spot: T.SpotLight;
    figure?: Character;
    gun?: T.Group;
    key: string;
    /** Eased values: current and target. */
    forward: [number, number];
    yaw: [number, number];
    light: [number, number];
    lit: boolean;
    /** Projector mode: when the light was struck, while it strikes. */
    strike: number | null;
    /** The back light that picks the figure out from behind (projector mode). */
    back?: T.SpotLight;
    /** False keeps a built figure out of the picture. */
    shown: boolean;
};

export type PodiumSceneOptions = {
    /** How many podiums stand in the row. */
    count?: number;
    /** Full-detail characters and guns (as the studio builds them): for comparing costs. */
    full?: boolean;
    /**
     * Each podium is lit by its own lamps only: almost no fill, no rim light
     * and no floor pool until its light is on, and a light comes on with a
     * strike (a fast rise, a flicker, settling) instead of easing up.
     */
    projector?: boolean;
    /**
     * Whether motion is reduced besides the OS preference (the game's own
     * setting): focus and inspect jump instead of easing. Read on each change.
     */
    still?: () => boolean;
};

/** A projector strike: the light's share of its target over time (ms): rise, flicker, settle. */
const STRIKE: [number, number][] = [
    [0, 0],
    [25, 1.5],
    [55, 0.25],
    [85, 1.25],
    [120, 0.7],
    [165, 1.1],
    [240, 1],
];
export const STRIKE_MS = STRIKE[STRIKE.length - 1][0];

/** The strike curve at `ms` after the light was struck (1 once it has settled). */
export function strikeAt(ms: number): number {
    if (ms >= STRIKE_MS) return 1;
    for (let i = 1; i < STRIKE.length; i++) {
        const [t1, v1] = STRIKE[i];
        if (ms <= t1) {
            const [t0, v0] = STRIKE[i - 1];
            return v0 + ((v1 - v0) * (ms - t0)) / (t1 - t0);
        }
    }
    return 1;
}

export function createPodiumScene(
    host: HTMLElement,
    onLayout: (anchors: Anchor[]) => void,
    { count = PODIUMS, full = false, projector = false, still }: PodiumSceneOptions = {},
): PodiumScene {
    const renderer = new T.WebGLRenderer({
        antialias: true,
        powerPreference: "low-power",
        preserveDrawingBuffer: true,
    });
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    host.append(renderer.domElement);

    const css = getComputedStyle(host);
    const token = (name: string, fallback: string) =>
        new T.Color(css.getPropertyValue(name).trim() || fallback);
    const background = token("--background-color", "#0b0d0e");
    const raised = token("--raised-color", "#191b1c");
    const line = token("--border-color", "#2a2d2e");
    const accent = token("--accent-color", "#7fd6e0");

    const scene = new T.Scene();
    scene.background = background;
    scene.fog = new T.Fog(background, 7, 13);
    // Low fill: a podium without its own light reads as a silhouette.
    scene.add(new T.HemisphereLight(0xc8d0d4, 0x0c0e10, projector ? 0.03 : 0.32));
    if (!projector) {
        const rimLight = new T.DirectionalLight(0x9fb8c4, 0.9);
        rimLight.position.set(0, 3, -4);
        scene.add(rimLight);
    }
    // An unlit podium's engraved rim barely shows.
    const dimLine = background.clone().lerp(line, 0.18);

    const camera = new T.PerspectiveCamera(28, 1, 0.1, 30);
    // Aimed a little low: the lower fifth of the frame holds the base plates.
    const target = new T.Vector3(0, 0.98, 0);

    const floor = new T.Mesh(
        new T.CircleGeometry(9, 48),
        new T.MeshStandardMaterial({ color: background, roughness: 0.9, metalness: 0.1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    const plinthGeometry = new T.CylinderGeometry(0.52, 0.58, PLINTH_TOP, 40);
    const rimGeometry = new T.TorusGeometry(0.53, 0.006, 4, 64);
    const slots: Slot[] = [];
    for (let i = 0; i < count; i++) {
        const group = new T.Group();
        group.position.x = (i - (count - 1) / 2) * SPACING;
        const plinth = new T.Mesh(
            plinthGeometry,
            new T.MeshStandardMaterial({ color: raised, roughness: 0.55, metalness: 0.45 }),
        );
        plinth.position.y = PLINTH_TOP / 2;
        const rim = new T.Mesh(rimGeometry, new T.MeshBasicMaterial({ color: line }));
        rim.rotation.x = Math.PI / 2;
        rim.position.y = PLINTH_TOP + 0.002;
        // A narrow cone: a dark podium gets no spill from its neighbours' lights.
        const spot = new T.SpotLight(0xfff1e2, 0, 7, 0.32, 0.55, 1.2);
        spot.position.set(0, 4.2, 1.2);
        spot.target.position.set(0, 0.9, 0);
        group.add(plinth, rim, spot, spot.target);
        let back: T.SpotLight | undefined;
        if (projector) {
            // The rim light, per podium: a narrow cone from behind.
            back = new T.SpotLight(0x9fb8c4, 0, 9, 0.3, 0.6, 1.2);
            back.position.set(0, 3, -3.5);
            back.target.position.set(0, 1, 0);
            group.add(back, back.target);
        }
        scene.add(group);
        slots.push({
            group,
            plinth,
            rim,
            spot,
            key: "",
            forward: [0, 0],
            yaw: [0, 0],
            light: [0, 0],
            lit: true,
            strike: null,
            back,
            shown: true,
        });
    }

    const assets = new CharacterAssets();
    const equipment = new EquipmentAssets(full ? "high" : "low");
    let focused: number | null = null;
    let inspected: number | null = null;
    let raf = 0;
    let frames = 0;
    let disposed = false;
    let epoch = 0;

    const LIGHT_ON = 26;
    const LIGHT_REST = 9;
    const LIGHT_GLANCE = 3.5;
    /** The back light's intensity relative to the front spot's. */
    const BACK_SHARE = 0.7;

    const settleTargets = () => {
        slots.forEach((slot, i) => {
            const on = focused === i;
            slot.forward[1] = on ? 0.38 : 0;
            // At rest the outer figures stand three-quarter, turned toward the
            // centre; the one under the cursor faces the camera.
            const x = slot.group.position.x;
            slot.yaw[1] = on ? 0 : x < -1e-3 ? 0.42 : x > 1e-3 ? -0.42 : 0;
            slot.light[1] = !slot.lit
                ? inspected === i
                    ? LIGHT_GLANCE
                    : 0
                : on
                  ? LIGHT_ON
                  : focused === null
                    ? LIGHT_REST * 1.4
                    : LIGHT_REST;
            (slot.rim.material as T.MeshBasicMaterial).color.copy(
                on && slot.lit ? accent : projector && !slot.lit ? dimLine : line,
            );
        });
    };

    const apply = () => {
        for (const slot of slots) {
            slot.group.position.z = slot.forward[0];
            if (slot.figure) {
                slot.figure.root.rotation.y = slot.yaw[0];
                slot.figure.root.visible = slot.shown;
            }
            slot.spot.intensity = slot.light[0];
            if (slot.back) slot.back.intensity = slot.light[0] * BACK_SHARE;
        }
    };

    const draw = () => {
        if (disposed || document.hidden) return;
        renderer.render(scene, camera);
        frames++;
    };

    /** Ease every value toward its target; frames run only until all have arrived. */
    const step = () => {
        raf = 0;
        let moving = false;
        const now = performance.now();
        for (const slot of slots) {
            if (slot.strike !== null) {
                const elapsed = now - slot.strike;
                if (elapsed >= STRIKE_MS) slot.strike = null;
                else moving = true;
                slot.light[0] = slot.light[1] * strikeAt(elapsed);
            }
            for (const pair of [slot.forward, slot.yaw, slot.light]) {
                if (pair === slot.light && slot.strike !== null) continue;
                const d = pair[1] - pair[0];
                if (Math.abs(d) > 1e-3 * (pair === slot.light ? 50 : 1)) {
                    pair[0] += d * 0.22;
                    moving = true;
                } else pair[0] = pair[1];
            }
        }
        apply();
        draw();
        if (moving) raf = requestAnimationFrame(step);
    };
    const animate = () => {
        if (!raf && !disposed) raf = requestAnimationFrame(step);
    };
    const reducedMotion = () =>
        window.matchMedia("(prefers-reduced-motion: reduce)").matches || !!still?.();
    const jump = () => {
        for (const slot of slots)
            for (const pair of [slot.forward, slot.yaw, slot.light]) pair[0] = pair[1];
        apply();
        draw();
    };

    function anchors(): Anchor[] {
        // Layout px, not client px: the screen root may be zoomed (phone landscape).
        const width = host.clientWidth;
        const height = host.clientHeight;
        const project = (v: T.Vector3) => {
            const p = v.clone().project(camera);
            return { x: ((p.x + 1) / 2) * width, y: ((1 - p.y) / 2) * height };
        };
        return slots.map((slot) => {
            const x = slot.group.position.x;
            const base = project(new T.Vector3(x, 0, 0.6));
            const top = project(new T.Vector3(x, 2.1, 0));
            const left = project(new T.Vector3(x - SPACING / 2, 0, 0.6));
            const right = project(new T.Vector3(x + SPACING / 2, 0, 0.6));
            return { x: base.x, base: base.y, top: top.y, width: right.x - left.x };
        });
    }

    const resize = () => {
        const { width, height } = host.getBoundingClientRect();
        if (!width || !height) return;
        renderer.setPixelRatio(
            Math.min(devicePixelRatio, 1.5, Math.sqrt(1_600_000 / (width * height))),
        );
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        // Fit the row (and the figures' height) whatever the aspect.
        const halfW = ((count - 1) / 2) * SPACING + 0.8;
        const halfH = 1.78;
        const tanV = Math.tan(T.MathUtils.degToRad(camera.fov / 2));
        const distance = Math.max(halfH / tanV, halfW / (tanV * camera.aspect));
        camera.position.set(0, 1.75, distance + 0.6);
        camera.lookAt(target);
        camera.updateProjectionMatrix();
        draw();
        onLayout(anchors());
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    document.addEventListener("visibilitychange", draw);

    settleTargets();
    jump();
    resize();

    async function build(recruit: Recruit): Promise<{ figure: Character; gun?: T.Group }> {
        const primary = itemById(recruit.equipment.primary);
        const figure = await assets.create(
            recruit.appearance,
            recruit.equipment.armor,
            "idle",
            "operative",
            primary?.model,
            { detail: full ? "full" : "figurine" },
        );
        figure.setArmorColors(recruit.armorColors);
        if (!full) await reduce(figure.root);
        const fitted = Object.fromEntries(
            Object.entries(recruit.attachments ?? {}).filter(([, id]) =>
                ATTACHMENTS.some((a) => a.id === id),
            ),
        );
        const gun = primary
            ? await equipment.get(primary.model, fitted, recruit.weaponSkin)
            : undefined;
        if (gun) mountHandEquipment(gun, figure.hand, figure.mount);
        return { figure, gun };
    }

    const cache = new Map<string, { figure: Character; gun?: T.Group }>();
    const keyOf = (r: Recruit | null) =>
        r
            ? JSON.stringify([
                  r.id,
                  r.appearance,
                  r.equipment,
                  r.attachments,
                  r.armorColors,
                  r.weaponSkin,
              ])
            : "";

    return {
        async setFigures(figures) {
            const ticket = ++epoch;
            const keys = figures.map(keyOf);
            // Built figures are kept by look and kit: a swap or a preview that
            // comes back moves a figure between plinths instead of rebuilding.
            await Promise.all(
                keys.map(async (key, i) => {
                    const recruit = figures[i];
                    if (!key || !recruit || cache.has(key)) return;
                    const built = await build(recruit);
                    if (disposed || cache.has(key)) built.figure.dispose();
                    else cache.set(key, built);
                }),
            );
            if (disposed || ticket !== epoch) return;
            slots.forEach((slot, i) => {
                const key = keys[i];
                if (slot.key === key) return;
                if (slot.figure && slots.every((s) => s === slot || s.figure !== slot.figure))
                    slot.figure.root.removeFromParent();
                const built = key ? cache.get(key) : undefined;
                slot.key = key;
                slot.figure = built?.figure;
                slot.gun = built?.gun;
                if (built) {
                    built.figure.root.position.y = PLINTH_TOP;
                    slot.group.add(built.figure.root);
                }
            });
            // Keep a few spare figures for the next preview; let the rest go.
            const shown = new Set(keys);
            const spare = [...cache.keys()].filter((k) => !shown.has(k));
            for (const key of spare.slice(0, Math.max(0, spare.length - 4))) {
                const built = cache.get(key)!;
                built.figure.root.removeFromParent();
                built.figure.dispose();
                cache.delete(key);
            }
            apply();
            draw();
        },
        focus(index) {
            focused = index;
            settleTargets();
            if (reducedMotion()) jump();
            else animate();
        },
        setLit(index, lit, instant = false) {
            const slot = slots[index];
            const was = slot.lit;
            slot.lit = lit;
            settleTargets();
            if (instant || reducedMotion()) {
                slot.strike = null;
                jump();
            } else if (projector && lit && !was) {
                // A lamp striking, not a fade; a timer settles it if no frame does.
                const struck = performance.now();
                slot.strike = struck;
                slot.light[0] = 0;
                window.setTimeout(() => {
                    if (disposed || slot.strike !== struck) return;
                    slot.strike = null;
                    slot.light[0] = slot.light[1];
                    apply();
                    draw();
                }, STRIKE_MS + 80);
                animate();
            } else animate();
        },
        setShown(index, shown) {
            slots[index].shown = shown;
            apply();
            draw();
        },
        inspect(index) {
            inspected = index;
            settleTargets();
            if (reducedMotion()) jump();
            else animate();
        },
        turn(angle) {
            if (focused === null) return;
            slots[focused].yaw[0] = slots[focused].yaw[1] = angle;
            apply();
            draw();
        },
        anchors,
        breakdown() {
            const parts: Record<string, { meshes: number; triangles: number; skinned: number }> =
                {};
            for (const slot of slots) {
                slot.group.traverse((o) => {
                    if (!(o instanceof T.Mesh) || o === slot.plinth || o === slot.rim) return;
                    let part = o.userData.nativePart as string | undefined;
                    for (let p: T.Object3D | null = o; !part && p; p = p.parent)
                        if (p === slot.gun) part = "gun";
                    part ??= "other";
                    const g = o.geometry as T.BufferGeometry;
                    const triangles = (g.index ? g.index.count : g.attributes.position.count) / 3;
                    const entry = (parts[part] ??= { meshes: 0, triangles: 0, skinned: 0 });
                    entry.meshes++;
                    entry.triangles += triangles;
                    if (o instanceof T.SkinnedMesh) entry.skinned++;
                });
            }
            return parts;
        },
        stats() {
            return {
                triangles: renderer.info.render.triangles,
                calls: renderer.info.render.calls,
                frames,
            };
        },
        dispose() {
            disposed = true;
            cancelAnimationFrame(raf);
            observer.disconnect();
            document.removeEventListener("visibilitychange", draw);
            for (const built of cache.values()) built.figure.dispose();
            assets.dispose();
            equipment.dispose();
            plinthGeometry.dispose();
            rimGeometry.dispose();
            floor.geometry.dispose();
            (floor.material as T.Material).dispose();
            for (const slot of slots) {
                (slot.plinth.material as T.Material).dispose();
                (slot.rim.material as T.Material).dispose();
            }
            renderer.dispose();
            renderer.forceContextLoss();
            renderer.domElement.remove();
        },
    };
}

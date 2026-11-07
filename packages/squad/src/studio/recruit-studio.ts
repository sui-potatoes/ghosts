// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { mountHandEquipment } from "./held-equipment";
import * as T from "three";
import { WeaponCarry } from "../motion/weapon-carry";
import { loadMotions } from "../motion/clips";
import { MotionPlayer, type MotionState } from "../motion/player";
import type { Motion } from "../motion/catalog";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CharacterAssets, type Character, type CharacterLook } from "./character-assets";
import { EquipmentAssets } from "./equipment-assets";
import { ATTACHMENTS, EQUIPMENT, itemById } from "../catalog";
import type { Appearance, Recruit } from "../types";
import { breather } from "./breather";
export type Focus = "body" | "face";
export interface RecruitStudio {
    apply(recruit: Recruit, appearance?: Appearance, look?: CharacterLook): Promise<void>;
    focus(value: Focus): void;
    view(angle: number): void;
    portrait(appearance: Appearance): Promise<string>;
    equipmentImages(): Promise<Record<string, string>>;
    playMotion(name: Motion, loop: boolean, speed: number): Promise<void>;
    pauseMotion(): void;
    resumeMotion(): void;
    seekMotion(time: number): void;
    stopMotion(): void;
    dispose(): void;
}
export function createRecruitStudio(
    host: HTMLElement,
    onMotion: (state: MotionState) => void,
): RecruitStudio {
    const renderer = new T.WebGLRenderer({
        antialias: true,
        powerPreference: "low-power",
        preserveDrawingBuffer: true,
    });
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    host.append(renderer.domElement);
    // Keep the studio and thumbnail backgrounds tied to the host application's theme.
    const theme = getComputedStyle(host);
    const palette = {
        surface: new T.Color(theme.getPropertyValue("--squad-studio-background").trim()),
        raised: new T.Color(theme.getPropertyValue("--squad-studio-platform").trim()),
        line: new T.Color(theme.getPropertyValue("--squad-studio-line").trim()),
    };
    const scene = new T.Scene();
    scene.background = palette.surface.clone();
    scene.fog = new T.Fog(palette.surface, 4, 10);
    const camera = new T.PerspectiveCamera(31, 1, 0.01, 20);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableDamping = false;
    controls.rotateSpeed = 0.55;
    // Yaw only: vertical drags cannot tilt the body or facial view.
    controls.minPolarAngle = Math.PI / 2;
    controls.maxPolarAngle = Math.PI / 2;
    const ambient = new T.HemisphereLight(0xdddddd, 0x414141, 1.4);
    scene.add(ambient);
    const key = new T.DirectionalLight(0xfff3e8, 2.5);
    key.position.set(-2, 3, 4);
    scene.add(key);
    const fill = new T.DirectionalLight(0xffffff, 0.9);
    fill.position.set(3, 1, 3);
    scene.add(fill);
    const rim = new T.DirectionalLight(0xffffff, 1.5);
    rim.position.set(1, 2, -2);
    scene.add(rim);
    const set = new T.Group();
    scene.add(set);
    const floorMat = new T.MeshStandardMaterial({
        color: palette.raised,
        roughness: 0.65,
        metalness: 0.35,
    });
    const floor = new T.Mesh(new T.CylinderGeometry(1.02, 1.05, 0.08, 64), floorMat);
    floor.position.y = -0.045;
    set.add(floor);
    const ring = new T.Mesh(
        new T.TorusGeometry(0.96, 0.007, 4, 96),
        new T.MeshBasicMaterial({ color: palette.line }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.005;
    set.add(ring);
    const shadowCanvas = document.createElement("canvas");
    shadowCanvas.width = shadowCanvas.height = 128;
    const ctx = shadowCanvas.getContext("2d")!;
    const gradient = ctx.createRadialGradient(64, 64, 5, 64, 64, 60);
    gradient.addColorStop(0, "rgba(0,0,0,.65)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
    const shadowMap = new T.CanvasTexture(shadowCanvas);
    const shadow = new T.Mesh(
        new T.PlaneGeometry(1.2, 0.8),
        new T.MeshBasicMaterial({
            map: shadowMap,
            transparent: true,
            depthWrite: false,
        }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.004;
    set.add(shadow);
    const assets = new CharacterAssets(),
        equipment = new EquipmentAssets();
    let displayedKey = "";
    /** The built character's recruit, gear and look: what a restyle may keep. */
    let displayedBase = "";
    let displayedAttachments = "";
    let player: MotionPlayer | undefined;
    let carry: WeaponCarry | undefined;
    let activeMotion: string | undefined;
    let currentRecruit: Recruit | undefined;
    let currentSex: Appearance["sex"] = "female";
    let currentLook: CharacterLook = "operative";
    let motionEpoch = 0;
    let current: Character | undefined,
        weapon: T.Group | undefined,
        focus: Focus = "body",
        disposed = false,
        epoch = 0,
        raf = 0;
    function draw() {
        if (!disposed && !document.hidden) {
            renderer.render(scene, camera);
            host.dataset.drawCalls = String(renderer.info.render.calls);
        }
    }
    function schedule() {
        if (!raf && !disposed)
            raf = requestAnimationFrame(() => {
                raf = 0;
                draw();
            });
    }
    controls.addEventListener("change", schedule);
    // Frame the stage against one reference height, never the selected recruit.
    const stageHeight = 1.8;
    const framing = (angle = controls.getAzimuthalAngle(), keepDistance = false) => {
        const eye = current?.eye ?? new T.Vector3(0, 1.55, 0.1);
        const target =
            focus === "face"
                ? eye.clone().add(new T.Vector3(0, -0.025, 0))
                : new T.Vector3(0, stageHeight * 0.51, 0);
        const desired = focus === "face" ? 0.4 : stageHeight * 1.28;
        const distance = keepDistance
            ? controls.getDistance()
            : Math.max(
                  focus === "face" ? 0.62 : 2.8,
                  desired /
                      (2 *
                          Math.tan(T.MathUtils.degToRad(camera.fov / 2)) *
                          Math.min(1, camera.aspect)),
              );
        controls.minDistance = focus === "face" ? 0.3 : 1.7;
        controls.maxDistance = focus === "face" ? 1.3 : 6;
        controls.target.copy(target);
        camera.position
            .copy(target)
            .add(new T.Vector3(Math.sin(angle) * distance, 0, Math.cos(angle) * distance));
        controls.update();
        schedule();
        set.visible = focus === "body";
        if (weapon) weapon.visible = focus === "body" && activeMotion !== "standing_smoking";
    };
    const resize = () => {
        const { width, height } = host.getBoundingClientRect();
        if (!width || !height) return;
        renderer.setPixelRatio(
            Math.min(devicePixelRatio, 1.5, Math.sqrt(1_400_000 / (width * height))),
        );
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        framing();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    document.addEventListener("visibilitychange", schedule);
    // Thumbnail passes use the same renderer and immediately restore the live viewport.
    // They render at SUPERSAMPLE× and scale down on a 2D canvas, which smooths
    // hair and silhouette edges far better than the renderer's own MSAA.
    const SUPERSAMPLE = 2;
    /** Textures this renderer already holds on the GPU. */
    const uploaded = new WeakSet<T.Texture>();
    /**
     * Get an object ready to draw before its first frame: shaders compile in
     * parallel (the driver's own threads when it can) and each new texture
     * uploads in its own step, instead of all of it freezing that frame.
     */
    async function prepare(object: T.Object3D, view: T.Camera, target: T.Scene) {
        // Background compiles can take far longer in wall time than compiling
        // on the spot; past a short wait the first frame finishes whatever is left.
        await Promise.race([
            renderer.compileAsync(object, view, target),
            new Promise((resolve) => setTimeout(resolve, 150)),
        ]);
        const textures = new Set<T.Texture>();
        object.traverse((o) => {
            if (!(o instanceof T.Mesh)) return;
            for (const m of Array.isArray(o.material) ? o.material : [o.material])
                for (const value of Object.values(m))
                    if (value instanceof T.Texture && !uploaded.has(value)) textures.add(value);
        });
        for (const texture of textures) {
            if (disposed) return;
            renderer.initTexture(texture);
            uploaded.add(texture);
            await breather();
        }
    }
    /** Encode off the main thread where the browser can (`toDataURL` blocks). */
    function encode(canvas: HTMLCanvasElement): Promise<string> {
        return new Promise((resolve) =>
            canvas.toBlob(
                (blob) => {
                    if (!blob) return resolve(canvas.toDataURL("image/webp", 0.9));
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result as string);
                    reader.onerror = () => resolve("");
                    reader.readAsDataURL(blob);
                },
                "image/webp",
                0.9,
            ),
        );
    }
    async function capture(object: T.Object3D, eye?: T.Vector3): Promise<string> {
        const preview = new T.Scene();
        preview.background = palette.surface.clone();
        // The stage's fog starts well past any capture's subject; sharing it
        // lets captures reuse the stage's compiled shaders.
        preview.fog = scene.fog;
        for (const light of [ambient, key, fill, rim]) preview.add(light.clone());
        preview.add(object);
        // Portraits are head and shoulders at 4:5, large enough for the hire deck's cards.
        const portrait = Boolean(eye),
            width = portrait ? 480 : 320,
            height = portrait ? 600 : 160;
        const cam = new T.PerspectiveCamera(portrait ? 30 : 35, width / height, 0.01, 20);
        // Portraits frame the eye; a character's bounds would skin every vertex.
        const bounds = portrait ? null : new T.Box3().setFromObject(object),
            center =
                eye?.clone().add(new T.Vector3(0, -0.06, 0)) ?? bounds!.getCenter(new T.Vector3()),
            size = bounds?.getSize(new T.Vector3());
        const distance = size ? Math.max(size.x / (width / height), size.y) * 1.7 + 0.2 : 0.82;
        cam.position
            .copy(center)
            .add(new T.Vector3(portrait ? 0.06 : 0.12, portrait ? 0.02 : 0.08, distance));
        cam.lookAt(center);
        await prepare(object, cam, preview);
        if (disposed) {
            object.removeFromParent();
            return "";
        }
        const viewportSize = renderer.getSize(new T.Vector2());
        const pixelRatio = renderer.getPixelRatio();
        renderer.setPixelRatio(SUPERSAMPLE);
        renderer.setSize(width, height, false);
        renderer.render(preview, cam);
        const out = document.createElement("canvas");
        out.width = width;
        out.height = height;
        const context = out.getContext("2d")!;
        context.imageSmoothingQuality = "high";
        context.drawImage(renderer.domElement, 0, 0, width, height);
        object.removeFromParent();
        renderer.setPixelRatio(pixelRatio);
        renderer.setSize(viewportSize.x, viewportSize.y, false);
        draw();
        return encode(out);
    }
    function attachGun(person: Character, gun?: T.Group) {
        weapon?.removeFromParent();
        weapon = gun;
        carry = undefined;
        if (gun) {
            mountHandEquipment(gun, person.hand, person.mount);
            carry = new WeaponCarry(gun, person.root.getObjectByName("mixamorigLeftHand")!);
        }
        if (weapon) weapon.visible = focus === "body" && activeMotion !== "standing_smoking";
    }
    async function previewWeapon(pistol: boolean) {
        const person = current,
            ticket = motionEpoch;
        if (!person || !currentRecruit || currentLook === "office-worker") return;
        const item = itemById(
            pistol ? currentRecruit.equipment.sidearm : currentRecruit.equipment.primary,
        );
        const gun = item
            ? await equipment.get(item.model, pistol ? {} : currentRecruit.attachments)
            : undefined;
        if (gun) await prepare(gun, camera, scene);
        if (disposed || ticket !== motionEpoch || person !== current) return;
        attachGun(person, gun);
    }
    return {
        async apply(recruit, appearance = recruit.appearance, look = "operative") {
            const ticket = ++epoch;
            const key = JSON.stringify([recruit.id, appearance, recruit.equipment, look]);
            const base = JSON.stringify([recruit.id, recruit.equipment, look]);
            const attachmentKey = JSON.stringify(recruit.attachments ?? {});
            // Colour and tint edits restyle the built character instead of building anew.
            if (
                current &&
                displayedKey !== key &&
                displayedBase === base &&
                current.restyle(appearance)
            )
                displayedKey = key;
            if (current && displayedKey === key) {
                const person = current;
                currentRecruit = recruit;
                current.setArmorColors(recruit.armorColors);
                if (displayedAttachments !== attachmentKey) {
                    const item =
                        look === "office-worker" ? undefined : itemById(recruit.equipment.primary);
                    const gun = item
                        ? await equipment.get(item.model, recruit.attachments)
                        : undefined;
                    if (gun) await prepare(gun, camera, scene);
                    if (disposed || ticket !== epoch || person !== current) return;
                    attachGun(person, gun);
                    displayedAttachments = attachmentKey;
                }
                draw();
                return;
            }
            const next = await assets.create(
                appearance,
                recruit.equipment.armor,
                "idle",
                look,
                itemById(recruit.equipment.primary)?.model,
            );
            if (disposed || ticket !== epoch) {
                next.dispose();
                return;
            }
            const item = look === "office-worker" ? undefined : itemById(recruit.equipment.primary);
            const gun = item ? await equipment.get(item.model, recruit.attachments) : undefined;
            if (disposed || ticket !== epoch) {
                next.dispose();
                return;
            }
            next.setArmorColors(recruit.armorColors);
            await prepare(next.root, camera, scene);
            if (gun) await prepare(gun, camera, scene);
            if (disposed || ticket !== epoch) {
                next.dispose();
                return;
            }
            motionEpoch++;
            player?.dispose();
            currentRecruit = recruit;
            currentLook = look;
            currentSex = appearance.sex;
            weapon?.removeFromParent();
            current?.root.removeFromParent();
            current?.dispose();
            current = next;
            displayedKey = key;
            displayedBase = base;
            displayedAttachments = attachmentKey;
            scene.add(next.root);
            weapon?.removeFromParent();
            weapon = gun;
            attachGun(next, gun);
            player = new MotionPlayer(next.root, draw, onMotion, (name) => {
                activeMotion = name;
                carry?.update(name === "toss_grenade");
                if (weapon) weapon.visible = focus === "body" && name !== "standing_smoking";
            });
            framing(undefined, focus === "body");
            draw();
        },
        async playMotion(name, loop, speed) {
            if (!current) throw Error("The character is still loading.");
            const ticket = ++motionEpoch;
            const library = await loadMotions(
                currentSex,
                itemById(currentRecruit?.equipment.primary ?? null)?.model,
            );
            if (disposed || ticket !== motionEpoch) return;
            const clip =
                currentLook === "office-worker" && name === "idle_weight_shift"
                    ? current.idleClip
                    : library.get(name);
            if (!clip) throw Error("This motion is unavailable.");
            await previewWeapon(name.startsWith("pistol"));
            if (disposed || ticket !== motionEpoch) return;
            const preview = clip.clone();
            const hips = preview.tracks.find((t) => t.name === "mixamorigHips.position");
            if (hips)
                for (let i = 0; i < hips.values.length; i += 3) {
                    hips.values[i] = 0;
                    hips.values[i + 2] = 0;
                }
            if (name === "toss_grenade") carry?.prepare(preview, current.root);
            player?.play(preview, loop, speed);
        },
        pauseMotion() {
            player?.pause();
        },
        resumeMotion() {
            player?.resume();
        },
        seekMotion(time) {
            player?.seek(time);
        },
        stopMotion() {
            motionEpoch++;
            player?.stop();
            void previewWeapon(false).then(draw);
        },
        focus(value) {
            if (value === focus) return;
            focus = value;
            if (value === "face") {
                motionEpoch++;
                player?.stop();
                void previewWeapon(false).then(draw);
            }
            framing();
        },
        view(angle) {
            framing(angle);
        },
        async portrait(appearance) {
            const person = await assets.create(appearance, null);
            if (disposed) {
                person.dispose();
                return "";
            }
            const result = await capture(person.root, person.eye);
            person.dispose();
            return result;
        },
        async equipmentImages() {
            const result: Record<string, string> = {};
            for (const item of EQUIPMENT) {
                const object = await equipment.get(item.model);
                if (disposed) return result;
                result[item.id] = await capture(object);
                await breather();
            }
            for (const item of ATTACHMENTS) {
                const object = await equipment.attachment(item.id);
                if (disposed) return result;
                object.quaternion.setFromRotationMatrix(
                    new T.Matrix4().makeBasis(
                        new T.Vector3(0, 0, -1),
                        new T.Vector3(1, 0, 0),
                        new T.Vector3(0, -1, 0),
                    ),
                );
                result[item.id] = await capture(object);
                await breather();
            }
            return result;
        },
        dispose() {
            disposed = true;
            epoch++;
            motionEpoch++;
            player?.dispose();
            cancelAnimationFrame(raf);
            observer.disconnect();
            document.removeEventListener("visibilitychange", schedule);
            controls.dispose();
            weapon?.removeFromParent();
            current?.dispose();
            assets.dispose();
            equipment.dispose();
            const gs = new Set<T.BufferGeometry>(),
                ms = new Set<T.Material>();
            set.traverse((o) => {
                if (o instanceof T.Mesh) {
                    gs.add(o.geometry);
                    for (const m of Array.isArray(o.material) ? o.material : [o.material])
                        ms.add(m);
                }
            });
            gs.forEach((g) => g.dispose());
            ms.forEach((m) => m.dispose());
            shadowMap.dispose();
            renderer.dispose();
            renderer.domElement.remove();
        },
    };
}

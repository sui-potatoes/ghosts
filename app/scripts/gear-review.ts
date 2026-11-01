// Silent, local visual regression bench. Uses the same assets and poses as the game.
import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createLongGun, type LongGunKind } from "@ghosts/squad/studio/long-guns";
import { EquipmentAssets } from "@ghosts/squad/studio/equipment-assets";
import { CharacterAssets } from "@ghosts/squad/studio/character-assets";
import { mountHandEquipment } from "@ghosts/squad/studio/held-equipment";
import { WeaponCarry } from "@ghosts/squad/motion/weapon-carry";
import { initialSquad } from "@ghosts/squad/model";
import { motions } from "@ghosts/squad/motion/catalog";
import { loadMotions } from "@ghosts/squad/motion/clips";
import type { Sex } from "@ghosts/squad/types";
const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(1200, 850);
renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
document.body.append(renderer.domElement);
const scene = new T.Scene();
scene.background = new T.Color("#11171a");
const camera = new T.PerspectiveCamera(32, 1200 / 850, 0.01, 30);
const controls = new OrbitControls(camera, renderer.domElement);
scene.add(new T.HemisphereLight(0xdde7eb, 0x4a4c4c, 2));
for (const [p, c, i] of [
    [[1, 3, 4], 0xfff1e0, 3],
    [[-3, 1, 2], 0xc1d6ed, 1.5],
    [[2, 2, -3], 0xb7d3d5, 4],
] as const) {
    const l = new T.DirectionalLight(c, i);
    l.position.set(...p);
    scene.add(l);
}
const gear = new EquipmentAssets(),
    people = new CharacterAssets();
let content = new T.Group();
scene.add(content);
let character: Awaited<ReturnType<CharacterAssets["create"]>> | undefined;
const select = (name: string) =>
    document.querySelector(`select[aria-label="${name}"]`) as HTMLSelectElement;
const view = select("View"),
    pose = select("Pose"),
    sexSelect = select("Body"),
    weapon = select("Weapon"),
    page = select("Sheet");
pose.innerHTML = motions
    .map(([name, label]) => `<option value="${name}">${label}</option>`)
    .join("");
pose.value = "idle_weight_shift";
page.innerHTML =
    '<option value="single">Single pose</option>' +
    Array.from(
        { length: 7 },
        (_, i) => `<option value="${i}">Poses ${i * 6 + 1}–${Math.min(38, (i + 1) * 6)}</option>`,
    ).join("");
const labels = document.getElementById("labels")!,
    status = document.getElementById("status")!;
function draw() {
    renderer.render(scene, camera);
}
controls.addEventListener("change", draw);
function angle(a: number) {
    const target = controls.target.clone(),
        d = camera.position.distanceTo(target);
    camera.position.copy(target).add(new T.Vector3(Math.sin(a) * d, 0.12, Math.cos(a) * d));
    controls.update();
    draw();
}
document.getElementById("front")!.onclick = () => angle(0);
document.getElementById("back")!.onclick = () => angle(Math.PI);
document.getElementById("side")!.onclick = () => angle(Math.PI / 2);
async function build() {
    status.textContent = "Loading";
    labels.innerHTML = "";
    content.removeFromParent();
    character?.dispose();
    character = undefined;
    content = new T.Group();
    scene.add(content);
    renderer.setSize(
        view.value.startsWith("orbit-") ? 1600 : 1200,
        view.value.startsWith("orbit-") ? 1600 : 850,
    );
    renderer.setScissorTest(false);
    renderer.clear();
    renderer.setViewport(0, 0, 1200, 850);
    camera.aspect = 1200 / 850;
    camera.updateProjectionMatrix();
    if (view.value === "weapon-detail") {
        let model: T.Group;
        if (new URLSearchParams(location.search).has("source")) {
            model = createLongGun(weapon.value as LongGunKind);
            model.quaternion.setFromRotationMatrix(
                new T.Matrix4().makeBasis(
                    new T.Vector3(0, 0, -1),
                    new T.Vector3(1, 0, 0),
                    new T.Vector3(0, -1, 0),
                ),
            );
        } else model = await gear.get(weapon.value as LongGunKind);
        content.add(model);
        const center = new T.Box3().setFromObject(model).getCenter(new T.Vector3());
        controls.target.copy(center);
        camera.position.copy(center).add(new T.Vector3(-0.08, 0.07, -1.1));
        controls.update();
        draw();
        labels.textContent = weapon.selectedOptions[0].text + " / STANDALONE PROFILE";
    } else if (view.value === "clips" || view.value === "optics" || view.value === "reflex") {
        const ids =
            view.value === "clips"
                ? ["standard", "clip-1", "clip-2", "clip-3"]
                : view.value === "reflex"
                  ? ["scope-1"]
                  : ["scope-1", "scope-2", "scope-3"];
        const names =
            view.value === "clips"
                ? ["STANDARD", "BASIC +1", "ADVANCED +2", "SUPERIOR +3"]
                : ["BASIC / REFLEX", "ADVANCED", "SUPERIOR"];
        for (let i = 0; i < ids.length; i++) {
            let model: T.Object3D;
            if (ids[i] === "standard") {
                const rifle = await gear.get("rifle");
                let mount!: T.Object3D;
                rifle.traverse((o) => {
                    if (o.userData.interface === "ghosts:clip:v1") mount = o;
                });
                model = mount.children[0].clone();
            } else model = await gear.attachment(ids[i]);
            const wrap = new T.Group();
            model.quaternion.setFromRotationMatrix(
                new T.Matrix4().makeBasis(
                    new T.Vector3(0, 0, -1),
                    new T.Vector3(1, 0, 0),
                    new T.Vector3(0, -1, 0),
                ),
            );
            wrap.add(model);
            const box = new T.Box3().setFromObject(wrap),
                center = box.getCenter(new T.Vector3());
            model.position.sub(center);
            wrap.position.x = (i - (ids.length - 1) / 2) * (view.value === "clips" ? 0.105 : 0.24);
            content.add(wrap);
        }
        controls.target.set(0, 0, 0);
        camera.position.set(0.035, 0.045, view.value === "clips" ? 0.53 : 0.8);
        if (view.value === "reflex") camera.position.set(-0.1, 0.065, 0.15);
        controls.update();
        draw();
        labels.textContent =
            view.value === "reflex" ? "BASIC SCOPE / COMPACT REFLEX" : names.join("     /     ");
    } else if (view.value === "weapons" || view.value === "utilities") {
        const kinds =
            view.value === "weapons"
                ? (["rifle", "sniper", "pistol"] as const)
                : (["grenade", "medkit"] as const);
        for (let i = 0; i < kinds.length; i++) {
            const model = await gear.get(kinds[i]);
            model.position.set(0, (kinds.length - 1 - i) * 0.34, 0);
            content.add(model);
        }
        controls.target.set(0, kinds.length === 3 ? 0.35 : 0.17, 0);
        camera.position.set(0.12, controls.target.y + 0.25, 2.15);
        controls.update();
        draw();
        labels.innerHTML =
            view.value === "weapons"
                ? "MX–4 CARBINE<br>SRS–9 PRECISION<br>K–12 SIDEARM"
                : "M7 FRAGMENTATION<br>FIELD TRAUMA KIT";
    } else {
        const sex = sexSelect.value as Sex,
            recruit = initialSquad().recruits.find((r) => r.appearance.sex === sex)!;
        const c = (character = await people.create(
            recruit.appearance,
            view.value === "orbit-unit"
                ? "nyx-heavy"
                : ["none", "grip", "wrist", "trigger"].includes(view.value) ||
                    view.value.startsWith("orbit-")
                  ? null
                  : view.value,
            "rest",
        ));
        c.setArmorColors({ primary: "#485358", secondary: "#687877", accent: "#4ba3a0" });
        // Diagnostic-only isolation exposes hand surfaces hidden by the torso or kit.
        if (
            new URLSearchParams(location.search).has("isolate") &&
            ["orbit-left", "orbit-right"].includes(view.value)
        ) {
            c.root.traverse((o) => {
                if (o instanceof T.SkinnedMesh) {
                    const g = o.geometry.clone(),
                        a = g.attributes,
                        idx = g.index!;
                    const handVertex = (i: number) => {
                        for (let k = 0; k < 4; k++)
                            if (
                                a.skinWeight.getComponent(i, k) > 0.2 &&
                                /(?:Left|Right)Hand/.test(
                                    o.skeleton.bones[a.skinIndex.getComponent(i, k)].name,
                                )
                            )
                                return true;
                        return false;
                    };
                    const keep: number[] = [];
                    for (let i = 0; i < idx.count; i += 3) {
                        const tri = [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)];
                        if (tri.some(handVertex)) keep.push(...tri);
                    }
                    g.setIndex(keep);
                    o.geometry = g;
                } else if (o instanceof T.Mesh) o.visible = false;
            });
        }
        content.add(c.root);
        const library = await loadMotions(sex, weapon.value),
            guns = await Promise.all([
                gear.get(weapon.value as "sniper" | "rifle" | "plasma", {
                    laser: "laser-3",
                    scope: "scope-1",
                    clip: "clip-3",
                }),
                gear.get("pistol"),
            ]);
        if (new URLSearchParams(location.search).has("source")) {
            const source = createLongGun(weapon.value as LongGunKind, {
                laser: "laser-3",
                scope: "scope-1",
                clip: "clip-3",
            });
            source.quaternion.setFromRotationMatrix(
                new T.Matrix4().makeBasis(
                    new T.Vector3(0, 0, -1),
                    new T.Vector3(1, 0, 0),
                    new T.Vector3(0, -1, 0),
                ),
            );
            const group = new T.Group();
            group.userData.model = weapon.value;
            group.userData.center = [0, 0, 0];
            group.add(source);
            guns[0] = group;
        }
        const carries = guns.map((g) => {
            mountHandEquipment(g, c.hand, c.mount);
            return new WeaponCarry(g, c.root.getObjectByName("mixamorigLeftHand")!);
        });
        const mixer = new T.AnimationMixer(c.root);
        function apply(name: string) {
            carries.forEach((c) => c.update(false));
            mixer.stopAllAction();
            const index = name.startsWith("pistol_") ? 1 : 0;
            guns.forEach((g, i) => (g.visible = i === index));
            const clip = library.get(name)!.clone();
            const hips = clip.tracks.find((t) => t.name === "mixamorigHips.position");
            if (hips)
                for (let k = 0; k < hips.values.length; k += 3) {
                    hips.values[k] = 0;
                    hips.values[k + 2] = 0;
                }
            if (name === "toss_grenade") carries[index].prepare(clip, c.root);
            const action = mixer.clipAction(clip).play();
            action.time = name === "idle_weight_shift" ? 0.8 : clip.duration * 0.5;
            mixer.update(0);
            c.root.updateMatrixWorld(true);
            carries[index].update(name === "toss_grenade");
            c.root.updateMatrixWorld(true);
        }
        if (view.value.startsWith("orbit-")) {
            apply(pose.value);
            renderer.setScissorTest(true);
            camera.aspect = 1;
            camera.updateProjectionMatrix();
            const gun = guns[0],
                target = new T.Vector3(
                    ...(view.value === "orbit-unit"
                        ? [0, -0.05, 0]
                        : view.value === "orbit-left"
                          ? [0.085, -0.03, 0]
                          : [-0.14, -0.05, 0]),
                );
            const angles = [
                ...Array.from({ length: 8 }, (_, i) => [(i * Math.PI) / 4, 0]),
                ...Array.from({ length: 4 }, (_, i) => [(i * Math.PI) / 2, Math.PI / 3]),
                ...Array.from({ length: 4 }, (_, i) => [(i * Math.PI) / 2, -Math.PI / 3]),
            ];
            angles.forEach(([yaw, pitch], i) => {
                const x = (i % 4) * 400,
                    y = (3 - Math.floor(i / 4)) * 400;
                renderer.setViewport(x, y, 400, 400);
                renderer.setScissor(x, y, 400, 400);
                const offset = new T.Vector3(
                    Math.sin(yaw) * Math.cos(pitch),
                    Math.sin(pitch),
                    Math.cos(yaw) * Math.cos(pitch),
                ).multiplyScalar(view.value === "orbit-unit" ? 1.05 : 0.38);
                camera.position.copy(gun.localToWorld(target.clone().add(offset)));
                camera.up.copy(new T.Vector3(0, 1, 0).transformDirection(gun.matrixWorld));
                camera.lookAt(gun.localToWorld(target.clone()));
                draw();
                const label = document.createElement("div");
                label.textContent = `${sex}/${weapon.value} ${Math.round((yaw * 180) / Math.PI)}° / ${Math.round((pitch * 180) / Math.PI)}°`;
                label.style.cssText = `position:absolute;left:${x + 8}px;top:${Math.floor(i / 4) * 400 + 8}px;font-size:13px;letter-spacing:0;background:#111a`;
                labels.append(label);
            });
            camera.up.set(0, 1, 0);
        } else if (page.value === "single") {
            apply(pose.value);
            controls.target.set(0, 1.22, 0);
            camera.position.set(1.7, 1.37, 0.2);
            if (view.value === "grip") {
                const gun = guns[0];
                controls.target.copy(gun.localToWorld(new T.Vector3(0.12, 0.005, 0)));
                camera.position.copy(gun.localToWorld(new T.Vector3(0.28, 0.19, -0.4)));
            }
            if (view.value === "wrist" || view.value === "trigger") {
                const gun = guns[0];
                controls.target.copy(
                    gun.localToWorld(
                        new T.Vector3(
                            ...(view.value === "wrist" ? [0.08, -0.025, 0.02] : [-0.13, -0.04, 0]),
                        ),
                    ),
                );
                camera.position.copy(
                    gun.localToWorld(
                        new T.Vector3(
                            ...(view.value === "wrist" ? [0.48, 0.03, 0.14] : [-0.22, 0.06, -0.27]),
                        ),
                    ),
                );
            }
            controls.update();
            draw();
            labels.textContent = `${view.selectedOptions[0].text} / ${sex.toUpperCase()} / ${pose.selectedOptions[0].text}`;
        } else {
            const start = Number(page.value) * 6;
            renderer.setScissorTest(true);
            camera.aspect = 200 / 425;
            camera.updateProjectionMatrix();
            for (let i = 0; i < 6; i++) {
                const item = motions[start + i];
                if (!item) continue;
                apply(item[0]);
                for (let a = 0; a < 2; a++) {
                    const x = (i % 3) * 400 + a * 200,
                        y = 425 * (1 - Math.floor(i / 3));
                    renderer.setViewport(x, y, 200, 425);
                    renderer.setScissor(x, y, 200, 425);
                    const head = c.root
                            .getObjectByName("mixamorigHead")!
                            .getWorldPosition(new T.Vector3()),
                        hips = c.root
                            .getObjectByName("mixamorigHips")!
                            .getWorldPosition(new T.Vector3());
                    const target = head.clone().lerp(hips, 0.65);
                    camera.position
                        .copy(target)
                        .add(a ? new T.Vector3(3.6, 0.15, 0.1) : new T.Vector3(1, 0.15, 3.5));
                    camera.lookAt(target);
                    draw();
                }
                const label = document.createElement("div");
                label.textContent = `${start + i + 1}. ${item[1]}`;
                label.style.cssText = `position:absolute;left:${(i % 3) * 400 + 10}px;top:${Math.floor(i / 3) * 425 + 10}px;font-size:13px;width:380px;letter-spacing:0px`;
                labels.append(label);
            }
        }
    }
    status.textContent = `${sexSelect.value.toUpperCase()} · ${weapon.selectedOptions[0].text} · ${view.selectedOptions[0].text} · AUDIO DISABLED`;
}
let queue = build();
for (const control of [view, pose, sexSelect, weapon, page])
    control.onchange = () => {
        queue = queue.then(build).catch((e) => {
            status.textContent = String(e);
            throw e;
        });
    };

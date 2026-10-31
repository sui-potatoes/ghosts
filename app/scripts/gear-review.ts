// Silent, local visual regression bench. Uses the same assets and poses as the game.
import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
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
    [[2, 2, -3], 0xb7d3d5, 2],
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
    renderer.setScissorTest(false);
    renderer.clear();
    renderer.setViewport(0, 0, 1200, 850);
    camera.aspect = 1200 / 850;
    camera.updateProjectionMatrix();
    if (view.value === "weapons" || view.value === "utilities") {
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
            view.value === "none" ? null : view.value,
            "rest",
        ));
        c.setArmorColors({ primary: "#485358", secondary: "#687877", accent: "#4ba3a0" });
        content.add(c.root);
        const library = await loadMotions(sex),
            guns = await Promise.all([
                gear.get(weapon.value as "sniper" | "rifle"),
                gear.get("pistol"),
            ]);
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
        if (page.value === "single") {
            apply(pose.value);
            controls.target.set(0, 1.22, 0);
            camera.position.set(1.7, 1.37, 0.2);
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

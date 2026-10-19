import {WeaponCarry} from "../../src/features/squad/motion/weapon-carry";
import {coverStepClips} from './cover-step';
import {physicalCover} from './high-cover';
// @ts-ignore Native contact helpers.
import {restoreTerrainPose,fitTerrainFeet} from './terrain-contact.js';
// @ts-ignore Shared native skinning contact helper.
import {soleMinimum} from './sole-contact.js';
// @ts-ignore Native editor adapter is shared JavaScript.
import {attachNativeBody,nativeAnimations} from "./mpfb-characters.js";
import {
  IdleDirector,
  type IdleContext,
  type IdleChoice,
} from "./idle-behavior";
import { createSidearm, SIDEARM_MOUNT_OFFSET } from "./sidearm";
import { aimClip, combatClips } from "./combat-pose";
import { createWeaponMount } from "./weapon-mount";
import * as T from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import type { Unit, Weapon } from "./game";
import { restMotion } from "./motions";
let asset: GLTF;
const idleDirector = new IdleDirector();
export async function loadOperatives(renderer: T.WebGLRenderer) {
  const ktx = new KTX2Loader()
    .setTranscoderPath("/demo-assets/basis/")
    .setWorkerLimit(1)
    .detectSupport(renderer);
  try {
    asset = await new GLTFLoader()
      .setKTX2Loader(ktx)
      .loadAsync("/demo-assets/models/blackline-operative.glb");
  } finally {
    ktx.dispose();
  }
}
export interface Rig {
  root: T.Group;
  model: T.Object3D;
  mixer: T.AnimationMixer;
  clips: Map<string, T.AnimationClip>;
  action: T.AnimationAction | null;
  fading?: T.AnimationAction;
  busy: boolean;
  dead: boolean;
  weapon: Weapon;
  gun: T.Object3D;
  rifle: T.Object3D;
  pistol: T.Group;
  scope: T.Group;
  hand: T.Object3D;
  leftHand: T.Object3D;
  rightPalm: T.Object3D;
  leftPalm: T.Object3D;
  leftForearm: T.Object3D;
  leftArm: T.Object3D;
  rightArm: T.Object3D;
  rightForearm: T.Object3D;
  aimTarget: T.Vector3 | null;
  hips: T.Object3D;
  hipAnchor: T.Vector3;
  hipScratch: T.Vector3;
  idlePhase: number;
  idleSpeed: number;
  idleBehavior?: {
    context: IdleContext;
    choice: IdleChoice;
    remaining: number;
  };
}
function detail(
  parent: T.Object3D,
  pos: number[],
  size: number[],
  color: number,
) {
  const m = new T.Mesh(
    new T.BoxGeometry(...(size as [number, number, number])),
    new T.MeshStandardMaterial({ color, metalness: 0.7, roughness: 0.38 }),
  );
  m.position.fromArray(pos);
  parent.add(m);
  return m;
}
export function soldier(u: Unit): Rig {
  const root = new T.Group(),
    model = clone(asset.scene);
  root.add(model);
  const materialCache = new Map<T.Material, T.Material>();
  const skeletonCache = new Map<string, T.Skeleton>();
  model.traverse((o) => {
    if (o instanceof T.SkinnedMesh) {
      // glTF material primitives can clone an identical bone palette. Upload it once per operator.
      const key = o.skeleton.bones.map((b) => b.uuid).join(":");
      const shared = skeletonCache.get(key);
      if (
        shared &&
        shared.boneInverses.every((m, i) =>
          m.equals(o.skeleton.boneInverses[i]),
        )
      )
        o.skeleton = shared;
      else skeletonCache.set(key, o.skeleton);
    }
    if (o instanceof T.Mesh) {
      o.castShadow = false;
      o.receiveShadow = true;
      const convert = (original: T.Material) => {
        if (materialCache.has(original)) return materialCache.get(original)!;
        if (original.name === "RifleTexture") {
          const weapon = original as T.MeshStandardMaterial;
          weapon.color.set("#414853");
          weapon.metalness = 0.35;
          weapon.roughness = 0.5;
        }
        const m = original as T.MeshStandardMaterial;
        if (m.map) {
          m.map.anisotropy = 2;
        }
        materialCache.set(original, m);
        return m;
      };
      o.material = Array.isArray(o.material)
        ? o.material.map(convert)
        : convert(o.material);
    }
  });
  attachNativeBody(model,u.id);
  const mixer = new T.AnimationMixer(model),
    clips = new Map(
      [...nativeAnimations(model.userData.mpfbSex), ...combatClips(nativeAnimations(model.userData.mpfbSex)), ...coverStepClips(model,nativeAnimations(model.userData.mpfbSex))].map((c) => [
        c.name,
        c,
      ]),
    );
  const initial = mixer.clipAction(clips.get("rifle_idle")!);
  initial.play();
  mixer.update(0.3);
  root.updateMatrixWorld(true);
  const find = (suffix: string) => {
    let result: T.Object3D | undefined;
    model.traverse((o) => {
      if (o.name.replaceAll(":", "").endsWith(suffix)) result = o;
    });
    if (!result) throw new Error(`Missing human bone: ${suffix}`);
    return result;
  };
  const hand = find("RightHand"),
    hips = find("Hips");
  // Calibrate the authored weapon direction in an aiming pose, not the scanning idle.
  initial.stop();
  const aim = mixer.clipAction(clips.get("shooting")!);
  aim.play();
  mixer.update(0.12);
  root.updateMatrixWorld(true);
  const authoredGun = model.getObjectByName("Rifle")!;
  const forward = new T.Vector3(0, 1, 0)
    .transformDirection(authoredGun.matrixWorld)
    .setY(0)
    .normalize();
  model.rotation.y = Math.PI - Math.atan2(forward.x, forward.z);
  aim.stop();
  initial.reset().play();
  mixer.update(0.3);
  model.scale.setScalar(0.96);
  root.updateMatrixWorld(true);
  // Native clips bake sole contact at local Y=0. Bounding-box grounding from
  // one arbitrary idle frame would offset every other pose and identity.
  model.position.y = 0;
  root.updateMatrixWorld(true);
  const rifle = model.getObjectByName("Rifle")!;
  const gun = createWeaponMount(rifle);
  model.userData.weaponCarry=new WeaponCarry(gun,find("LeftHand"));
  const pistol = createSidearm();
  pistol.visible = false;
  pistol.position.set(...SIDEARM_MOUNT_OFFSET);
  gun.add(pistol);
  const scope = new T.Group();
  scope.visible = false;
  rifle.add(scope);
  const tube = new T.Mesh(
    new T.CylinderGeometry(0.028, 0.028, 0.2, 16),
    new T.MeshStandardMaterial({
      color: 0x11191a,
      metalness: 0.8,
      roughness: 0.3,
    }),
  );

  tube.position.set(0, -0.05, -0.1);
  scope.add(tube);
  detail(scope, [0, -0.05, -0.07], [0.04, 0.06, 0.07], 0x343a3a);
  root.updateMatrixWorld(true);
  const rig: Rig = {
    root,
    model,
    mixer,
    clips,
    action: initial,
    busy: false,
    dead: false,
    weapon: u.weapon,
    gun,
    rifle,
    pistol,
    scope,
    hand,
    leftHand: find("LeftHand"),
    rightPalm: find("RightHandMiddle1"),
    leftPalm: find("LeftHandMiddle1"),
    leftForearm: find("LeftForeArm"),
    leftArm: find("LeftArm"),
    rightArm: find("RightArm"),
    rightForearm: find("RightForeArm"),
    aimTarget: null,
    hips,
    hipScratch: new T.Vector3(),
    idlePhase:
      ([...u.id].reduce((n, c) => n * 31 + c.charCodeAt(0), 0) % 97) / 97,
    idleSpeed: 1,
    hipAnchor: root.worldToLocal(hips.getWorldPosition(new T.Vector3())),
  };
  model.userData.refreshNativeRig=()=>{
    const motion=rig.action?.getClip().name??'rifle_idle';mixer.stopAllAction();mixer.uncacheRoot(model);clips.clear();
    const native=nativeAnimations(model.userData.mpfbSex);for(const clip of [...native,...combatClips(native),...coverStepClips(model,native)])clips.set(clip.name,clip);
    rig.action=null;rig.fading=undefined;play(rig,motion);mixer.update(0);root.updateMatrixWorld(true);
  };
  initial.time = initial.getClip().duration * rig.idlePhase;
  initial.setEffectiveTimeScale(rig.idleSpeed);
  setWeapon(rig, u.weapon);
  return rig;
}
export function play(
  r: Rig,
  name: string,
  once = false,
  speed = 1,
  blend = 0.24,
) {
  r.idleBehavior = undefined;
  const clip = r.clips.get(name);
  if (!clip) throw new Error(`Missing animation: ${name}`);
  const next = r.mixer.clipAction(clip);
  if (r.action === next && next.isRunning() && !once)
    return clip.duration / speed;
  r.model.userData.weaponCarry?.update(name === "toss_grenade");
  const previous = r.action;
  if (r.fading && r.fading !== previous && r.fading !== next) r.fading.stop();
  r.fading = previous !== next ? (previous ?? undefined) : undefined;
  next
    .reset()
    .setEffectiveTimeScale(speed)
    .setEffectiveWeight(1)
    .setLoop(once ? T.LoopOnce : T.LoopRepeat, once ? 1 : Infinity);
  next.paused = false;
  next.clampWhenFinished = once;
  next.play();
  if (previous && previous !== next) {
    previous.fadeOut(blend);
    next.fadeIn(blend);
  }
  r.action = next;
  return clip.duration / speed;
}
export function setWeapon(r: Rig, w: Weapon) {
  r.weapon = w;
  r.rifle.visible = w !== "pistol";
  r.pistol.visible = w === "pistol";
  r.scope.visible = w === "sniper";
}
export function updateHuman(r: Rig, dt: number, terrain?: (x: number, z: number) => number) {
  restoreTerrainPose(r.model);
  if (r.idleBehavior && !r.busy && !r.dead && !r.aimTarget) {
    r.idleBehavior.remaining -= dt;
    if (r.idleBehavior.remaining <= 0)
      chooseIdle(r, r.idleBehavior.context, r.idleBehavior.choice.clip);
  }
  r.mixer.update(dt);
  // Clips were grounded on bare feet. Include the equipped boot outsole,
  // and also guard interpolation between poses. Never pull lifted feet down.
  r.model.position.y = 0;
  if (!r.dead && (r.model.userData.fieldKit || (r.fading && r.fading.getEffectiveWeight() > 0))) {
    const skin = r.model.getObjectByName('Blackline_Face') as T.SkinnedMesh;
    const ground = r.root.getWorldPosition(r.hipScratch).y;
    const penetration = ground + .001 - soleMinimum(skin);
    if (penetration > 0) r.model.position.y = penetration;
  }
  // The renderer updates the full hierarchy once. Root correction only needs the hip ancestor chain.
  // Gameplay owns travel; prevent motion-capture root drift from moving a unit off its grid cell.
  const hip = r.root.worldToLocal(r.hips.getWorldPosition(r.hipScratch));
  r.model.position.x += r.hipAnchor.x - hip.x;
  r.model.position.z += r.hipAnchor.z - hip.z;
  if (terrain && !r.dead) fitTerrainFeet(r.model, r.root, terrain);
  // Captured skeletal tracks own the pose, including both hands.
}
export function resetHuman(r: Rig) {
  r.busy = false;
  r.dead = false;
  r.aimTarget = null;
  r.root.rotation.set(0, 0, 0);
  play(r, "rifle_idle");
}

export function holdHuman(r: Rig, name: string, time = -1) {
  r.idleBehavior = undefined;
  if (r.action?.getClip().name === name && r.action.paused) return;
  play(r, name, true);
  r.action!.time = time < 0 ? r.action!.getClip().duration : time;
  r.action!.paused = true;
  r.mixer.update(0);
}
function chooseIdle(r: Rig, context: IdleContext, previous = "") {
  const choice = idleDirector.next(context, previous);
  play(r, choice.clip, false, 1, 0.65);
  if (choice.hold !== null) {
    r.action!.time = choice.hold;
    r.action!.paused = true;
  } else r.action!.time = r.action!.getClip().duration * choice.phase;
  r.idleBehavior = { context, choice, remaining: choice.seconds };
}
export function restHuman(r: Rig, u: Unit, covered: boolean) {
  if (u.hunkered || u.overwatch) {
    r.idleBehavior = undefined;
    holdHuman(r, restMotion(u, covered));
    return;
  }
  const context: IdleContext =
    physicalCover(u.pos)==="low" ? "cover" : physicalCover(u.pos)==="high" ? "wall" : u.weapon === "pistol" ? "pistol" : covered ? "cover" : "open";
  if (r.idleBehavior?.context !== context) chooseIdle(r, context);
}
export function aimHuman(r: Rig, covered = false) {
  holdHuman(r, aimClip(r.weapon, covered), 0);
}

export function humanTextureStats() {
  const textures = new Set<T.Texture>();
  asset.scene.traverse((o) => {
    if (o instanceof T.Mesh)
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        for(const value of Object.values(m))if(value instanceof T.Texture)textures.add(value);
      }
  });
  return [...textures].map((t) => ({
    width: t.image.width,
    height: t.image.height,
    format: t.format,
    compressed: !!(t as T.CompressedTexture).isCompressedTexture,
    bytes: (t.mipmaps ?? []).reduce(
      (n, m) => n + ("data" in m ? (m.data as Uint8Array).byteLength : 0),
      0,
    ),
  }));
}

/** Portraits borrow shared assets but own their skeletons, tinted materials, and weapon details. */
export function disposePortrait(r: Rig) {
  const sharedGeometry = new Set<T.BufferGeometry>(),
    sharedMaterials = new Set<T.Material>();
  asset.scene.traverse((o) => {
    if (o instanceof T.Mesh) {
      sharedGeometry.add(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : [o.material])
        sharedMaterials.add(m);
    }
  });
  const skeletons = new Set<T.Skeleton>();
  r.root.traverse((o) => {
    if (o instanceof T.Mesh) {
      if (!sharedGeometry.has(o.geometry)) o.geometry.dispose();
      for (const m of Array.isArray(o.material) ? o.material : [o.material])
        if (!sharedMaterials.has(m)) m.dispose();
      if (o instanceof T.SkinnedMesh) skeletons.add(o.skeleton);
    }
  });
  for (const skeleton of skeletons) skeleton.dispose();
  r.mixer.stopAllAction();
  r.mixer.uncacheRoot(r.model);
  r.root.removeFromParent();
}

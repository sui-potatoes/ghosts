// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import { propHealth, propRandom, type MapProp, type PropDamage } from "../environment.ts";
import { footprint, type TacticalMap } from "../map.ts";
import { PropAssets, type PropAsset, type PropDamageStage } from "./prop-assets.ts";
import { SurfaceDamage } from "./surface-damage.ts";
import { cracksWhenDamaged } from "./prop-deformation.ts";
import { Occlusion } from "./occlusion.ts";

let loaded: Promise<void> | undefined;
let physics: typeof RAPIER;
/** Split WASM out of the menu bundle; initialize once when the encounter loads. */
export const loadDestruction = () => loaded ??= import("@dimforge/rapier3d-compat").then(async ({ default: api }) => {
  await api.init();
  physics = api;
});

const FIXED_STEP = 1 / 60;
// Debris (2) hits scenery (1), never other debris or actors.
const SCENERY_GROUP = 0x00010002, DEBRIS_GROUP = 0x00020001;
export const MAX_DEBRIS = 96;

interface PropView {
  prop: MapProp;
  asset: PropAsset;
  root: T.Group;
  intact: T.Group;
  damage?: SurfaceDamage;
  stage?: PropDamageStage;
  shed: Set<number>;
  colliders: RAPIER.Collider[];
  destroyed: boolean;
}
interface Debris {
  mesh: T.Mesh;
  body?: RAPIER.RigidBody;
  age: number;
  previous: T.Vector3;
  previousRotation: T.Quaternion;
}

/** Presentation-only physics. Cover and health always come from the event journal. */
export class Destruction {
  readonly group = new T.Group();
  readonly assets = new PropAssets();
  private world!: RAPIER.World;
  private readonly props = new Map<string, PropView>();
  private readonly officeOcclusion = new Occlusion();
  private readonly debris: Debris[] = [];
  private readonly smokeGeometry = new T.PlaneGeometry(1, 1);
  private readonly smokeOpacity = new T.InstancedBufferAttribute(new Float32Array(128), 1);
  private readonly smokeMaterial = new T.ShaderMaterial({
    transparent: true, depthWrite: false, side: T.DoubleSide,
    vertexShader: `
      attribute float instanceOpacity;
      varying vec2 vUv; varying float vOpacity;
      void main() {
        vUv=uv; vOpacity=instanceOpacity;
        gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);
      }`,
    fragmentShader: `
      varying vec2 vUv; varying float vOpacity;
      void main() {
        vec2 p=vUv*2.-1.;
        float edge=1.-smoothstep(.12,1.,length(p));
        float wisps=.72+.16*sin(p.x*11.+p.y*7.)+.12*sin(p.y*19.-p.x*9.);
        gl_FragColor=vec4(vec3(.32,.34,.35),edge*wisps*vOpacity);
      }`,
  });
  private readonly smoke = new T.InstancedMesh(this.smokeGeometry, this.smokeMaterial, 128);
  private readonly dust: { position: T.Vector3; age: number; seed: number }[] = [];
  private readonly transform = new T.Object3D();
  private readonly rotation = new T.Quaternion();
  private readonly position = new T.Vector3();
  private accumulator = 0;
  private time = 0;
  private budget = MAX_DEBRIS;
  private readonly shadowsChanged: () => void;

  constructor(map: TacticalMap, shadowsChanged: () => void) {
    this.shadowsChanged = shadowsChanged;
    this.group.name = "Destructible map props";
    this.smokeGeometry.setAttribute("instanceOpacity", this.smokeOpacity);
    this.smoke.instanceMatrix.setUsage(T.DynamicDrawUsage);
    this.smoke.frustumCulled = false;
    this.smoke.count = 0;
    this.reset(map);
  }

  get active() {
    return this.debris.some((part) => !!part.body);
  }

  get stats() {
    return {
      props: this.props.size,
      destroyed: [...this.props.values()].filter((p) => p.destroyed).length,
      bodies: this.debris.filter((p) => !!p.body).length,
      debris: this.debris.length,
    };
  }

  setBatterySaver(battery: boolean) {
    this.budget = battery ? 48 : MAX_DEBRIS;
  }

  private fixedBox(center: T.Vector3, size: T.Vector3, rotation?: T.Quaternion) {
    const desc = physics.ColliderDesc.cuboid(
      Math.max(0.015, size.x / 2), Math.max(0.015, size.y / 2), Math.max(0.015, size.z / 2),
    ).setTranslation(center.x, center.y, center.z).setCollisionGroups(SCENERY_GROUP).setFriction(0.8);
    if (rotation) desc.setRotation(rotation);
    return this.world.createCollider(desc);
  }

  reset(map: TacticalMap) {
    for (const view of this.props.values()) view.damage?.dispose();
    this.world?.free();
    this.world = new physics.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = FIXED_STEP;
    this.world.numSolverIterations = 4;
    this.group.clear(); this.props.clear(); this.debris.length = 0; this.dust.length = 0;
    this.officeOcclusion.occluders.length = 0;
    this.accumulator = 0; this.time = 0; this.smoke.count = 0;
    this.group.add(this.smoke);
    this.fixedBox(new T.Vector3(0, -0.15, 0), new T.Vector3(90, 0.3, 90));
    const { avenueHalf, crossHalf, curb } = map.plan.street;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const w = Math.max(0, 45 - avenueHalf), d = Math.max(0, 45 - crossHalf);
      if (w && d && curb)
        this.fixedBox(new T.Vector3(sx * (avenueHalf + w / 2), curb / 2, sz * (crossHalf + d / 2)),
          new T.Vector3(w, curb, d));
    }
    for (const [index, building] of map.plan.buildings.entries()) {
      if (building.prop) continue; // The live prop owns its exact colliders.
      const b = footprint(building);
      if (map.props.some((prop) => prop.storefront?.building === index)) {
        // Hollow only for cosmetic debris, so glass can fall inside the shop.
        // Tactical movement/LOS still use the original solid footprint.
        const w = b.w - 0.1, d = b.d - 0.1, base = map.plan.street.curb;
        const upper = building.h - 3.15;
        this.fixedBox(new T.Vector3(b.x, base + 3.15 + upper / 2, b.z), new T.Vector3(w, upper, d));
        this.fixedBox(new T.Vector3(b.x, base + 1.5, b.z - d / 2 + 0.1), new T.Vector3(w, 3, 0.2));
        const outerSide = building.kind === "seven" ? -1 : 1;
        this.fixedBox(new T.Vector3(b.x + outerSide * (w / 2 - 0.1), base + 1.5, b.z), new T.Vector3(0.2, 3, d));
      } else {
        this.fixedBox(new T.Vector3(b.x, building.h / 2, b.z), new T.Vector3(b.w, building.h, b.d));
      }
    }
    for (const prop of map.props) {
      const asset = this.assets.get(prop);
      const root = new T.Group(), intact = asset.intact.clone();
      root.name = `${prop.kind} / ${prop.id}`;
      root.position.set(prop.x, map.surfaceHeight(prop.x, prop.z) + (prop.y ?? 0), prop.z);
      root.rotation.y = prop.yaw;
      root.add(intact, asset.frame.clone());
      this.group.add(root); root.updateMatrixWorld(true);
      const colliders: RAPIER.Collider[] = [];
      // A window is a real opening: three masonry sections, with its own pane.
      const boxes = asset.colliders ?? (prop.kind === "window-wall" ? [
        new T.Box3(new T.Vector3(-1.15, 0, -0.12), new T.Vector3(1.15, 0.9, 0.12)),
        new T.Box3(new T.Vector3(-1.15, 0.9, -0.12), new T.Vector3(-0.71, 2.1, 0.12)),
        new T.Box3(new T.Vector3(0.71, 0.9, -0.12), new T.Vector3(1.15, 2.1, 0.12)),
        new T.Box3(new T.Vector3(-1.15, 1.88, -0.12), new T.Vector3(1.15, 2.17, 0.12)),
      ] : [asset.bounds]);
      for (const bounds of boxes) {
        const center = root.localToWorld(bounds.getCenter(new T.Vector3()));
        colliders.push(this.fixedBox(center, bounds.getSize(new T.Vector3()), root.quaternion));
      }
      const destroyed = map.health(prop.id) === 0;
      const view: PropView = { prop, asset, root, intact, colliders, destroyed, shed: new Set() };
      this.props.set(prop.id, view);
      if (["office-steel-wall", "office-window-wall", "office-shelf", "office-locker"].includes(prop.kind))
        this.officeOcclusion.occluders.push({ group: root, bounds: asset.bounds.clone().applyMatrix4(root.matrixWorld) });
      if (destroyed) {
        intact.visible = false;
        for (const collider of colliders) this.world.removeCollider(collider, true);
        colliders.length = 0;
      } else if (map.health(prop.id) < propHealth[prop.kind]) this.showDamage(view, map.health(prop.id));
    }
    for (const view of this.props.values())
      if (view.prop.support && !map.health(view.prop.support)) view.root.visible = false;
    this.shadowsChanged();
  }

  impactPoint(id: string, origin: T.Vector3) {
    const view = this.props.get(id);
    if (!view) return undefined;
    const bounds = view.asset.bounds.clone().applyMatrix4(view.root.matrixWorld);
    const center = bounds.getCenter(new T.Vector3());
    const ray = new T.Ray(origin, center.clone().sub(origin).normalize());
    return ray.intersectBox(bounds, new T.Vector3()) ?? center;
  }

  /** Glazing follows its building's camera occlusion rather than floating alone. */
  syncBuildingVisibility(visible: readonly boolean[]) {
    for (const view of this.props.values())
      if (view.prop.storefront) view.root.visible = visible[view.prop.storefront.building] ?? true;
  }

  isPropVisible(id: string) {
    const view = this.props.get(id);
    return !!view && view.root.visible && !view.destroyed;
  }

  syncOfficeVisibility(camera: T.Vector3, points: T.Vector3[]) {
    this.officeOcclusion.update(camera, points);
    for (const view of this.props.values()) if (view.prop.support) {
      const owner = this.props.get(view.prop.support);
      if (owner) view.root.visible = owner.root.visible && !owner.destroyed;
    }
  }

  private showDamage(view: PropView, hp: number) {
    const amount = 1 - hp / propHealth[view.prop.kind];
    if (cracksWhenDamaged(view.prop.kind)) {
      view.damage ??= new SurfaceDamage(view.intact, view.asset.bounds);
      view.damage.setAmount(amount);
      return [];
    }
    const stage = this.assets.damaged(view.prop, amount);
    if (!stage || stage === view.stage) return [];
    const newlyShed = [...stage.shed].filter((index) => !view.shed.has(index));
    view.intact.clear();
    view.intact.add(...stage.intact.clone().children);
    view.stage = stage;
    view.shed = new Set(stage.shed);
    return newlyShed;
  }

  apply(changes: readonly PropDamage[], origin: T.Vector3) {
    for (const change of changes) {
      const view = this.props.get(change.id);
      if (!view || view.destroyed) continue;
      if (!change.destroyed) {
        const shed = this.showDamage(view, change.hp);
        this.emitFragments(view, shed, origin, true);
        continue;
      }
      view.destroyed = true;
      view.intact.visible = false;
      view.damage?.dispose(); view.damage = undefined;
      for (const collider of view.colliders) this.world.removeCollider(collider, true);
      view.colliders.length = 0;
      this.emitFragments(view, view.asset.fragments.map((_, index) => index).filter((index) => !view.shed.has(index)), origin, false);
    }
    // A broken pane can retain its metal frame, but never float after the wall falls.
    for (const view of this.props.values())
      if (view.prop.support && this.props.get(view.prop.support)?.destroyed) view.root.visible = false;
    this.shadowsChanged();
  }

  private emitFragments(view: PropView, indices: readonly number[], origin: T.Vector3, partial: boolean) {
    view.root.updateMatrixWorld(true);
    if (!partial) this.dust.push({ position: view.root.position.clone().add(new T.Vector3(0, 0.4, 0)), age: 0, seed: view.prop.seed });
    for (const index of indices) {
      const template = view.asset.fragments[index];
      const random = propRandom(view.prop.seed + index * 977);
      // A hard cap includes sleeping rubble, bounding memory and draw calls.
      if (this.debris.length >= this.budget) this.removeDebris(0);
      const mesh = new T.Mesh(template.geometry, template.material);
      mesh.position.copy(template.position);
      if (partial) {
        // Start outside the remaining prop collider instead of trapping a
        // detached board/lid inside its intact collision approximation.
        const bounds = view.asset.bounds;
        const center = bounds.getCenter(new T.Vector3());
        const size = bounds.getSize(new T.Vector3());
        template.geometry.computeBoundingBox();
        const partCenter = template.geometry.boundingBox!.getCenter(new T.Vector3())
          .applyQuaternion(template.quaternion).add(template.position);
        const offset = partCenter.clone().sub(center).divide(size);
        const axis = view.prop.kind.startsWith("fence-") ? "z" :
          Math.abs(offset.y) > Math.max(Math.abs(offset.x), Math.abs(offset.z)) ? "y" :
          Math.abs(offset.x) > Math.abs(offset.z) ? "x" : "z";
        mesh.position[axis] += (offset[axis] >= 0 ? bounds.max[axis] + 0.06 : bounds.min[axis] - 0.06) - partCenter[axis];
      }
      mesh.position.applyMatrix4(view.root.matrixWorld);
      mesh.quaternion.copy(view.root.quaternion).multiply(template.quaternion);
      mesh.receiveShadow = true; mesh.castShadow = false;
      this.group.add(mesh);
      const direction = mesh.position.clone().sub(partial ? view.root.position : origin);
      if (partial) {
        // Clear the still-standing collider, particularly for loose drum lids.
        direction.y = 0;
        if (direction.lengthSq() < 0.001) direction.set(0, 0, 1);
        direction.normalize().multiplyScalar(1.6 + random() * 0.6);
        direction.y = 1;
      } else {
        direction.y = Math.max(0.3, direction.y);
        direction.normalize().multiplyScalar(1.8 + random() * 2.8);
        direction.y += 1.4 + random() * 1.2;
      }
      const paper = view.prop.kind === "office-papers", folder = view.prop.kind === "office-folders";
      const lightDocument = paper || folder;
      if (lightDocument) {
        // Broad, light sheets catch the blast and loft above the heavy debris.
        // Each fragment gets a seeded sideways drift and its own launch height.
        direction.x = direction.x * .45 + (random() - .5) * 2.2;
        direction.z = direction.z * .45 + (random() - .5) * 2.2;
        direction.y = paper ? 7 + random() * 2 : 5.8 + random() * 1.8;
      }
      mesh.name = `debris / ${view.prop.kind}`;
      const body = this.world.createRigidBody(physics.RigidBodyDesc.dynamic()
        .setTranslation(mesh.position.x, mesh.position.y, mesh.position.z)
        .setRotation(mesh.quaternion)
        .setLinvel(direction.x, direction.y, direction.z)
        .setAngvel({ x: random() * 5 - 2.5, y: random() * 5 - 2.5, z: random() * 5 - 2.5 })
        .setGravityScale(paper ? .55 : folder ? .7 : 1)
        .setLinearDamping(lightDocument ? .65 : .35).setAngularDamping(lightDocument ? .35 : 1.2)
        .setCcdEnabled(true).setCanSleep(true));
      // Convex hulls for shards; curved drum strips use a cheap enclosing hull.
      const vertices = new Float32Array(mesh.geometry.attributes.position.array);
      const collider = physics.ColliderDesc.convexHull(vertices);
      if (collider) {
        this.world.createCollider(collider.setCollisionGroups(DEBRIS_GROUP)
          .setDensity(lightDocument ? .08 : 1).setFriction(0.85).setRestitution(lightDocument ? .02 : .12), body);
        this.debris.push({
          mesh, body, age: 0, previous: mesh.position.clone(), previousRotation: mesh.quaternion.clone(),
        });
      } else {
        this.world.removeRigidBody(body);
        mesh.removeFromParent();
      }
    }
  }

  private removeDebris(index: number) {
    const part = this.debris[index];
    if (part.body) this.world.removeRigidBody(part.body);
    part.mesh.removeFromParent();
    this.debris.splice(index, 1);
    // Geometry/material remain cached for replay and other instances.
  }

  update(dt: number, camera: T.Camera) {
    this.time += dt;
    if (this.active) {
      this.accumulator += Math.min(dt, 0.1);
      while (this.accumulator >= FIXED_STEP) {
        for (const part of this.debris) if (part.body) {
          part.previous.copy(part.body.translation());
          part.previousRotation.copy(part.body.rotation());
        }
        this.world.step();
        this.accumulator -= FIXED_STEP;
      }
      const alpha = this.accumulator / FIXED_STEP;
      for (const part of this.debris) if (part.body) {
        part.age += dt;
        part.mesh.position.copy(part.previous).lerp(this.position.copy(part.body.translation()), alpha);
        part.mesh.quaternion.copy(part.previousRotation).slerp(this.rotation.copy(part.body.rotation()), alpha);
        if (part.body.isSleeping() || part.age > 6) {
          part.mesh.position.copy(part.body.translation());
          part.mesh.quaternion.copy(part.body.rotation());
          this.world.removeRigidBody(part.body);
          part.body = undefined;
        }
      }
    } else this.accumulator = 0;
    // Mode changes retire excess rubble gradually.
    for (let n = 0; n < 4 && this.debris.length > this.budget; n++) this.removeDebris(0);
    this.updateSmoke(dt, camera);
  }

  private updateSmoke(dt: number, camera: T.Camera) {
    let index = 0;
    camera.getWorldQuaternion(this.rotation);
    const puff = (origin: T.Vector3, age: number, seed: number, dust: boolean) => {
      if (index >= 128) return;
      const t = age / 3.6, swirl = seed + age;
      this.transform.position.copy(origin).add(new T.Vector3(
        Math.sin(swirl * 1.3) * (0.08 + t * 0.25) + t * 0.5,
        age * (dust ? 0.25 : 0.5),
        Math.cos(swirl * 0.8) * t * 0.2,
      ));
      this.transform.quaternion.copy(this.rotation);
      this.transform.scale.setScalar((dust ? 0.65 : 0.28) + t * (dust ? 1.9 : 1.05));
      this.transform.updateMatrix();
      this.smoke.setMatrixAt(index, this.transform.matrix);
      this.smokeOpacity.setX(index++, Math.sin(Math.PI * t) * (dust ? 0.22 : 0.28));
    };
    for (const view of this.props.values()) if (view.asset.smoke && !view.destroyed) {
      const origin = view.root.localToWorld(view.asset.smoke.clone());
      for (let i = 0; i < 8; i++) puff(origin, (this.time + i * 0.45) % 3.6, view.prop.seed + i, false);
    }
    for (let i = this.dust.length - 1; i >= 0; i--) {
      const dust = this.dust[i]; dust.age += dt;
      if (dust.age >= 3.6) { this.dust.splice(i, 1); continue; }
      for (let n = 0; n < 5; n++) puff(dust.position, dust.age, dust.seed + n * 7, true);
    }
    this.smoke.count = index;
    this.smoke.instanceMatrix.needsUpdate = true;
    this.smokeOpacity.needsUpdate = true;
  }

  dispose() {
    for (const view of this.props.values()) view.damage?.dispose();
    this.group.removeFromParent();
    this.world.free();
    this.group.clear(); this.props.clear(); this.debris.length = 0;
    this.assets.dispose();
    this.smoke.dispose(); this.smokeGeometry.dispose(); this.smokeMaterial.dispose();
  }
}

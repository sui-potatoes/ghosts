// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { shortestAngle, shoulderArc } from "../aim-transition";
import { perimeterMist } from "../atmosphere";
import { batchStaticScenery } from "../batching";
import type { GameEvent } from "../events";
import type { PropDamage } from "../environment";
import { FramePacer } from "../frame-pacer";
import { key, type Encounter, type Unit } from "../game";
import type { Cell } from "../map";
import { aimHuman, holdHuman, play } from "../humans";
import { createPortraitStudio } from "../portrait-studio";
import { renderCadence, renderPixelRatio, type RenderMode } from "../render-policy";
import { applyTimeOfDay, type TimeOfDay } from "../scene-weather";
import { Effects } from "./effects";
import { Destruction } from "./destruction";
import { mapView } from "./maps";
import { Occlusion } from "./occlusion";
import { Overlays } from "./overlays";
import { RenderProfiler } from "./profiler";
import { buildCovers, buildRelay } from "./props";
import { Precipitation, type Weather } from "./precipitation";
import { Space } from "./space";
import type { AimReadout } from "./markers";
import { Units } from "./units";

export interface BattlefieldOptions {
  /** Element the canvas fills; also carries the scene's QA data attributes. */
  viewport: HTMLElement;
  /** Element the unit name plates are positioned in, over the canvas. */
  labels: HTMLElement;
  /** Crosshair kept over the aim point in the shoulder camera, when given. */
  reticle?: HTMLElement;
  game: Encounter;
  renderer?: T.WebGLRenderer;
}

type SavedCamera = { position: T.Vector3; target: T.Vector3; fov: number };

/**
 * The 3D encounter: the district, the operatives and the camera. It shows the
 * encounter's state and animates the events the rules emit (`play`); it never
 * decides an outcome. The operatives (`units.ts`), ground overlays, rain,
 * effects, occlusion and profiling are its parts in this folder; this class
 * owns the camera, the aim, the render loop and the wiring between them.
 */
export class Battlefield {
  readonly scene = new T.Scene();
  readonly camera = new T.PerspectiveCamera(39, 1, 0.1, 180);
  readonly renderer: T.WebGLRenderer;
  readonly controls: OrbitControls;
  readonly host: HTMLElement;
  game: Encounter;
  renderMode: RenderMode = "battery";
  timeOfDay: TimeOfDay = "night";
  selected = "v";
  cinematic = false;
  paused = false;
  disposed = false;
  /** Resolves when the shoulder camera has settled on its target. */
  aimReady: Promise<void> = Promise.resolve();
  onPick: (p: Cell, id?: string) => void = () => {};
  onHover: (p: Cell) => void = () => {};

  private readonly space: Space;
  private readonly units: Units;
  private readonly overlays: Overlays;
  private readonly effects = new Effects(this);
  private readonly destruction: Destruction;
  private readonly occlusion = new Occlusion();
  private readonly precipitation = new Precipitation();
  private readonly profiler: RenderProfiler;
  private readonly reticle?: HTMLElement;
  private readonly sun = new T.DirectionalLight(0xc6d2ed, 3.6);
  private readonly ambient = new T.HemisphereLight(0xaebbd6, 0x14131a, 0.95);
  private readonly rim = new T.DirectionalLight(0xd69d70, 0.55);
  private readonly mist = perimeterMist();
  private readonly pacer = new FramePacer();
  private readonly resizeObserver: ResizeObserver;
  private readonly chestPoints: T.Vector3[] = [];
  private jobs: ((dt: number) => boolean)[] = [];
  private raf = 0;
  private activeUntil = 0;
  private viewportWidth = 1;
  private viewportHeight = 1;
  private draggingCamera = false;
  private supportedScenery: T.Object3D[] = [];
  private aimKey = "";
  private aimUnit = "";
  private aimPoint: T.Vector3 | null = null;
  private cameraMotion = false;
  private cameraSequence = 0;
  private savedCamera: SavedCamera | null = null;
  private readonly onVisibility = () => {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.pacer.reset();
    this.host.dataset.renderState = document.hidden ? "hidden" : "awake";
    if (!document.hidden) this.invalidate();
  };

  static createRenderer() {
    return new T.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "low-power" });
  }

  constructor({ viewport, labels, reticle, game, renderer = Battlefield.createRenderer() }: BattlefieldOptions) {
    this.host = viewport;
    this.game = game;
    this.reticle = reticle;
    this.renderer = renderer;
    this.profiler = new RenderProfiler(renderer, viewport);
    this.scene.background = new T.Color(0x0c1019);
    this.scene.fog = new T.FogExp2(0x252b3b, 0.019);
    renderer.setPixelRatio(1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    viewport.append(renderer.domElement);
    this.controls = this.createControls();
    this.light();
    this.space = new Space(game.map);
    this.destruction = new Destruction(game.map, () => {
      this.renderer.shadowMap.needsUpdate = true;
    });
    // Scenery places clones of the same catalog assets combat destroys.
    const kit = { props: this.destruction.assets };
    this.occlusion.occluders.push(...mapView(game.map.plan.id).build(this.scene, kit));
    if (!mapView(game.map.plan.id).furnishedCover) buildCovers(this.scene, this.space, kit.props);
    buildRelay(this.scene, this.space, game.relay);
    for (const { group } of this.occlusion.occluders) group.removeFromParent();
    this.scene.traverse(o => { if (o.userData.supportProp) this.supportedScenery.push(o); });
    for (const o of this.supportedScenery) o.removeFromParent();
    batchStaticScenery(this.scene);
    for (const o of this.supportedScenery) this.scene.add(o);
    for (const { group } of this.occlusion.occluders) {
      batchStaticScenery(group);
      group.position.set(0, 0, 0);
      group.quaternion.identity();
      this.scene.add(group);
    }
    this.scene.add(this.destruction.group, this.mist.mesh, this.effects.light, this.effects.group, this.precipitation.group);
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    this.overlays = new Overlays(this.scene, this.space);
    this.units = new Units({
      scene: this.scene,
      labels,
      host: viewport,
      game: () => this.game,
      space: this.space,
      animator: this,
      effects: this.effects,
      onPick: (id) => {
        const current = this.game.unit(id);
        if (current) this.onPick(current.pos, current.id);
      },
    });
    this.listen();
    document.addEventListener("visibilitychange", this.onVisibility);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(viewport);
    this.resize();
    const defaults = mapView(game.map.plan.id).defaults;
    if (defaults) {
      this.setTimeOfDay(defaults.time);
      this.setWeather(defaults.weather);
    }
    this.invalidate();
  }

  private createControls() {
    this.camera.position.set(22, 25, 28);
    const controls = new OrbitControls(this.camera, this.renderer.domElement);
    controls.target.set(0, 0, -0.3);
    controls.enableDamping = true;
    controls.dampingFactor = 0.15;
    controls.minDistance = 9;
    controls.maxDistance = 52;
    controls.minPolarAngle = 0.15;
    controls.maxPolarAngle = Math.PI * 0.47;
    controls.maxTargetRadius = 13;
    controls.mouseButtons = { LEFT: T.MOUSE.ROTATE, MIDDLE: T.MOUSE.DOLLY, RIGHT: T.MOUSE.PAN };
    controls.update();
    controls.addEventListener("change", () => this.invalidate());
    controls.addEventListener("start", () => {
      this.draggingCamera = true;
      this.invalidate();
    });
    controls.addEventListener("end", () => {
      this.draggingCamera = false;
      this.invalidate();
    });
    return controls;
  }

  private light() {
    const { sun, rim } = this;
    this.scene.add(this.ambient);
    sun.position.set(-16, 18, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -22;
    sun.shadow.camera.right = 22;
    sun.shadow.camera.top = 22;
    sun.shadow.camera.bottom = -22;
    sun.shadow.normalBias = 0.035;
    sun.shadow.bias = -0.0002;
    this.scene.add(sun);
    rim.position.set(15, 8, -10);
    this.scene.add(rim);
  }

  /** Clicks prefer a living unit's model, then fall back to its ground tile. */
  private listen() {
    const host = this.host;
    let down = [0, 0];
    host.addEventListener("pointerdown", (e) => {
      down = [e.clientX, e.clientY];
      this.invalidate();
    });
    host.addEventListener("pointerup", (e) => {
      if (e.button !== 0 || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
      const ray = this.pointerRay(e);
      const unit = this.units.pick(ray);
      if (unit) {
        this.onPick(unit.pos, unit.id);
        return;
      }
      const p = this.pick(e, ray);
      if (p) this.onPick(p, this.game.units.find((u) => u.hp > 0 && key(u.pos) === key(p))?.id);
    });
    host.addEventListener("pointermove", (e) => {
      if (e.buttons || this.draggingCamera || this.cameraMotion || this.aimKey) return;
      const p = this.pick(e);
      if (p && this.overlays.hoverAt(p)) {
        this.invalidate();
        this.onHover(p);
      }
    });
    host.addEventListener("pointerleave", () => {
      this.overlays.leave();
      this.invalidate();
    });
  }

  private pointerRay(e: PointerEvent): T.Raycaster {
    const rect = this.host.getBoundingClientRect();
    const ray = new T.Raycaster();
    ray.setFromCamera(
      new T.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, (-(e.clientY - rect.top) / rect.height) * 2 + 1),
      this.camera,
    );
    return ray;
  }

  private pick(e: PointerEvent, ray = this.pointerRay(e)): Cell | null {
    const p = new T.Vector3();
    return ray.ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), 0), p) ? this.space.cellAt(p) : null;
  }

  resize() {
    const { width, height } = this.host.getBoundingClientRect();
    if (!width || !height) return;
    this.viewportWidth = width;
    this.viewportHeight = height;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(renderPixelRatio(width, height, devicePixelRatio, this.renderMode));
    this.renderer.setSize(width, height);
    this.precipitation.setViewportHeight(height * this.renderer.getPixelRatio());
    this.invalidate();
  }

  // === Overlays ===

  get gridVisible() {
    return this.overlays.gridVisible;
  }

  setGrid(visible: boolean) {
    this.overlays.setGrid(visible);
    this.invalidate();
  }

  showRange(u: Unit, show: boolean) {
    this.overlays.showRange(this.game, u, show);
  }

  showGrenadeRange(u: Unit) {
    this.overlays.showGrenadeRange(u);
  }

  showPath(path: Cell[] | undefined, grenade = false) {
    this.overlays.showPath(path, grenade);
  }

  previewPath(p: Cell) {
    return this.overlays.previewPath(p);
  }

  setHover(visible: boolean) {
    this.overlays.setHover(visible);
  }

  /** Move the hover tile to `p`: the controller's cursor shares the mouse marker. */
  hoverAt(p: Cell) {
    if (this.overlays.hoverAt(p)) this.invalidate();
  }

  // === Camera ===

  select(id: string) {
    this.selected = id;
  }

  focus(id = this.selected) {
    if (this.aimKey || this.cameraMotion) return;
    const rig = this.units.rig(id);
    if (!rig) return;
    const target = rig.root.position.clone();
    const offset = this.camera.position.clone().sub(this.controls.target);
    const from = this.controls.target.clone();
    this.tween(0.6, (t) => {
      this.controls.target.copy(from).lerp(target, t);
      this.camera.position.copy(this.controls.target).add(offset);
    });
  }

  rotate(angle: number) {
    if (this.aimKey || this.cameraMotion) return;
    const v = this.camera.position.clone().sub(this.controls.target);
    v.applyAxisAngle(new T.Vector3(0, 1, 0), angle);
    this.camera.position.copy(this.controls.target).add(v);
    this.controls.update();
    this.invalidate();
  }

  /** Dolly toward (`factor` < 1) or away from the target; the controls clamp the distance. */
  dolly(factor: number) {
    if (this.aimKey || this.cameraMotion) return;
    const v = this.camera.position.clone().sub(this.controls.target);
    v.multiplyScalar(factor);
    this.camera.position.copy(this.controls.target).add(v);
    this.controls.update();
    this.invalidate();
  }

  /**
   * A screen-space step (up = away from the viewer) as the nearest grid step
   * under the current camera: stick directions follow the view, not the map.
   */
  screenDelta([sx, sy]: Cell): Cell {
    const f = this.controls.target.clone().sub(this.camera.position);
    const x = sx * -f.z + -sy * f.x;
    const z = sx * f.x + -sy * f.z;
    return Math.abs(x) >= Math.abs(z) ? [Math.sign(x), 0] : [0, Math.sign(z)];
  }

  /** Close camera on the selected operator, or the tactical overview. */
  view(cinematic: boolean) {
    this.cinematic = cinematic;
    const u = this.units.rig(this.selected)!;
    const target = cinematic ? u.root.position.clone().add(new T.Vector3(0, 0.7, 0)) : new T.Vector3(0, 0, -0.3);
    const position = target.clone().add(cinematic ? new T.Vector3(6, 3.5, 6) : new T.Vector3(22, 25, 28));
    const start = this.camera.position.clone(),
      startTarget = this.controls.target.clone();
    this.tween(0.85, (t) => {
      this.camera.position.copy(start).lerp(position, t);
      this.controls.target.copy(startTarget).lerp(target, t);
    });
  }

  /** Over the shoulder of `u`, aiming at `point`; resolves with `aimReady`. */
  aimAt(u: Unit, point: Cell, kind: "fire" | "grenade"): Promise<void> {
    const signature = `${u.id}:${u.pos}:${point}:${u.weapon}:${kind}`;
    if (signature === this.aimKey) return this.aimReady;
    const switchingTarget = this.aimUnit === u.id && !!this.aimKey;
    this.savedCamera ??= {
      position: this.camera.position.clone(),
      target: this.controls.target.clone(),
      fov: this.camera.fov,
    };
    this.aimKey = signature;
    ++this.cameraSequence;
    this.startCameraMotion();
    this.aimUnit = u.id;
    this.controls.enabled = false;
    const rig = this.units.rig(u.id)!;
    const look = this.space.vec(point, kind === "fire" ? 1.08 : 0.8);
    rig.aimTarget = look.clone();
    this.aimPoint = null;
    this.host.dataset.cameraMode = "shoulder";
    this.aimReady = (async () => {
      const wall = kind === "fire" && this.game.map.physicalCover(u.pos) === "high";
      const covered = this.game.cover(u) > 0 && !wall;
      if (wall) await this.units.exposeCorner(u, point, () => this.aimKey === signature);
      if (this.aimKey !== signature) return;
      const forward = look.clone().sub(rig.root.position).setY(0).normalize();
      if (!forward.lengthSq()) forward.set(0, 0, -1);
      const heading = Math.atan2(-forward.x, -forward.z);
      const wasAiming = !!rig.action?.getClip().name.endsWith("_fire") && !!rig.action.paused;
      if (kind === "fire") {
        if (covered && u.weapon !== "pistol" && !rig.action?.getClip().name.endsWith("_fire")) {
          await this.tween(play(rig, "covered_rise", true), () => {});
        }
        if (this.aimKey !== signature) return;
        if (wall && this.game.map.coverPeek(u.pos, point).blocked) holdHuman(rig, "stand_cover_idle", 0);
        else aimHuman(rig, covered);
      } else play(rig, "crouch_idle");
      // Let the held pose finish blending before measuring its actual shoulder.
      if (!wasAiming) await this.tween(0.25, () => {});
      if (this.aimKey !== signature) return;
      const head = rig.model.getObjectByName("mixamorigHead")!.getWorldPosition(new T.Vector3());
      const right = new T.Vector3().crossVectors(forward, new T.Vector3(0, 1, 0));
      const cameraPosition = head
        .clone()
        .addScaledVector(forward, kind === "fire" ? -2.5 : -4.2)
        .addScaledVector(right, kind === "fire" ? 0.62 : 1.5);
      cameraPosition.y += kind === "fire" ? -0.12 : 1.5;
      // Eye-level framing, with room for both shooter and target on narrow displays.
      const fov = kind === "grenade" ? 48 : this.camera.aspect < 1.2 ? 56 : 48;
      const turnStart = rig.root.rotation.y,
        turnDelta = shortestAngle(turnStart, heading);
      const pivot = rig.root.position.clone();
      await Promise.all([
        this.tween(0.65, (t) => {
          if (this.aimKey === signature) rig.root.rotation.y = turnStart + turnDelta * t;
        }),
        this.cameraTo(cameraPosition, look, fov, 0.65, switchingTarget ? pivot : undefined),
      ]);
      if (this.aimKey === signature) this.aimPoint = look;
    })();
    return this.aimReady;
  }

  /** Back to the camera saved before aiming, the shooter back into cover. */
  leaveAim(): Promise<void> {
    if (!this.savedCamera) return this.aimReady;
    const saved = this.savedCamera;
    this.savedCamera = null;
    this.aimKey = "";
    const aimingRig = this.units.rig(this.aimUnit);
    let returnPose = Promise.resolve();
    if (aimingRig && !aimingRig.dead) {
      aimingRig.aimTarget = null;
      const unit = this.game.unit(this.aimUnit)!;
      if (this.game.map.physicalCover(unit.pos) === "high") {
        returnPose = this.units.withdrawCorner(unit).then(() => {
          if (!this.aimKey) this.units.rest(unit);
        });
      } else if (
        this.game.cover(unit) > 0 &&
        unit.weapon !== "pistol" &&
        aimingRig.action?.getClip().name.endsWith("_fire")
      ) {
        returnPose = this.tween(play(aimingRig, "covered_return", true), () => {}).then(() => {
          if (!this.aimKey) this.units.rest(unit);
        });
      } else this.units.rest(unit);
    }
    this.aimUnit = "";
    this.aimPoint = null;
    this.host.dataset.cameraMode = "returning";
    this.aimReady = Promise.all([this.cameraTo(saved.position, saved.target, saved.fov, 0.65), returnPose]).then(
      () => {},
    );
    return this.aimReady;
  }

  private startCameraMotion() {
    this.cameraMotion = true;
    this.host.dataset.cameraReady = "false";
  }

  private cameraTo(position: T.Vector3, target: T.Vector3, fov: number, duration: number, orbit?: T.Vector3) {
    const sequence = ++this.cameraSequence;
    this.startCameraMotion();
    const start = this.camera.position.clone(),
      look = this.controls.target.clone(),
      startFov = this.camera.fov;
    return this.tween(duration, (t) => {
      if (sequence !== this.cameraSequence) return;
      if (orbit) shoulderArc(start, position, orbit, t, this.camera.position);
      else this.camera.position.copy(start).lerp(position, t);
      this.controls.target.copy(look).lerp(target, t);
      this.camera.fov = startFov + (fov - startFov) * t;
      this.camera.updateProjectionMatrix();
      this.camera.lookAt(this.controls.target);
    }).then(() => {
      if (sequence !== this.cameraSequence) return;
      this.cameraMotion = false;
      this.host.dataset.cameraReady = "true";
      this.controls.enabled = !this.aimKey;
      if (!this.aimKey) {
        this.host.dataset.cameraMode = this.cinematic ? "close" : "tactical";
        this.controls.enableDamping = false;
        this.controls.update();
        this.controls.enableDamping = true;
      }
    });
  }

  // === Animation ===

  tween(seconds: number, fn: (t: number) => void, smooth = true) {
    this.invalidate();
    return new Promise<void>((resolve) => {
      let elapsed = 0;
      this.jobs.push((dt) => {
        elapsed += dt;
        const t = Math.min(1, elapsed / seconds);
        fn(smooth ? t * t * (3 - 2 * t) : t);
        if (t < 1) return false;
        resolve();
        return true;
      });
    });
  }

  /** Animate an event the rules emitted; events with no motion resolve at once. */
  async play(event: GameEvent) {
    const unit = (id: string) => this.game.unit(id)!;
    switch (event.type) {
      case "move":
        return this.units.move(unit(event.unit), event.path);
      case "shot":
        return this.shot(unit(event.unit), unit(event.target), event.hit, event.environment ?? []);
      case "reload":
        return this.units.reload(unit(event.unit));
      case "grenade":
        return this.units.grenade(unit(event.unit), event.at, () => {
          this.destruction.apply(event.environment ?? [], this.space.vec(event.at, 0.2));
          this.invalidate();
        });
      case "hunker":
        return this.units.hunker(unit(event.unit));
      case "overwatch":
        return this.units.watch(unit(event.unit));
    }
  }

  /** A shot, with a camera kick on each tracer when it is framed over the shooter's shoulder. */
  private shot(a: Unit, b: Unit, hit: boolean, environment: PropDamage[]) {
    const shoulder = this.aimUnit === a.id;
    const kick = a.weapon === "sniper" ? 0.11 : 0.035;
    // The shoulder camera is settled before the trigger is pulled; each kick returns to it.
    const origin = this.camera.position.clone();
    let impacted = false;
    return this.units.fire(a, b, hit, {
      aimed: shoulder,
      impact: environment[0]?.impact ? new T.Vector3(...environment[0].impact) :
        environment.length ? this.destruction.impactPoint(environment[0].id, this.space.vec(a.pos, 1)) : undefined,
      kick: (t) => {
        if (!shoulder) return;
        this.camera.position.copy(origin);
        this.camera.position.y += Math.sin(t * Math.PI) * kick;
        this.camera.lookAt(this.controls.target);
      },
      afterTracer: () => {
        if (!impacted && environment.length) {
          this.destruction.apply(environment, this.space.vec(a.pos, 1));
          impacted = true;
        }
        if (shoulder) this.camera.position.copy(origin);
      },
    });
  }

  /** Swap in a fresh encounter: every rig out of its pose and back on its start cell. */
  redeploy(game: Encounter) {
    this.game = game;
    this.space.map = game.map;
    this.destruction.reset(game.map);
    this.units.redeploy();
    this.invalidate();
  }

  /** Bring rigs and markers in line with the encounter after the rules changed it. */
  sync() {
    this.units.sync(this.selected, !!this.aimKey);
  }

  /** Hit odds and the predicted hp cut on the aimed hostile's plate; null clears. */
  setAimReadout(target: Unit | null, readout?: AimReadout) {
    this.units.aimReadout(target, readout);
  }

  // === Settings ===

  /** Freeze animation jobs, rigs and rain; the last frame stays on screen. */
  setPaused(paused: boolean) {
    this.paused = paused;
    this.host.dataset.paused = String(paused);
    this.pacer.reset();
    this.invalidate();
  }

  setTimeOfDay(time: TimeOfDay) {
    this.timeOfDay = time;
    const interior = mapView(this.game.map.plan.id).interiorLighting;
    this.mist.mesh.visible = !interior;
    if (interior) {
      this.renderer.toneMappingExposure = interior(this.scene, this.sun, this.ambient, this.rim, time);
    } else {
      const p = applyTimeOfDay(this.scene, this.sun, this.ambient, this.rim, time);
      this.renderer.toneMappingExposure = p.exposure;
      this.mist.mesh.material.uniforms.tint.value.setHex(p.mist);
    }
    this.renderer.shadowMap.needsUpdate = true;
    this.host.dataset.timeOfDay = time;
    this.invalidate();
  }

  get weather() { return this.precipitation.kind; }

  get indoors() { return !!mapView(this.game.map.plan.id).interiorLighting; }

  setWeather(weather: Weather) {
    this.precipitation.setKind(weather);
    this.host.dataset.weather = weather;
    this.host.dataset.rain = String(weather === "rain");
    this.host.dataset.snowParticles = String(this.precipitation.particles);
    this.invalidate();
  }

  setRenderMode(mode: RenderMode) {
    this.renderMode = mode;
    this.destruction.setBatterySaver(mode === "battery");
    this.precipitation.setBatterySaver(mode === "battery");
    this.host.dataset.snowParticles = String(this.precipitation.particles);
    this.resize();
  }

  // === Render loop ===

  /** Keep rendering for a while; frames stop when nothing moves. */
  invalidate() {
    this.activeUntil = performance.now() + 1200;
    if (!this.disposed && !document.hidden && !this.raf) {
      this.pacer.reset();
      this.raf = requestAnimationFrame(this.animate);
    }
  }

  private animate = (now: number) => {
    this.raf = 0;
    if (this.disposed) return;
    const active = now < this.activeUntil || this.jobs.length > 0 || this.units.busy || this.destruction.active;
    const rate = renderCadence(this.renderMode, !document.hidden, active);
    if (rate === null) {
      this.pacer.reset();
      this.host.dataset.renderState = document.hidden ? "hidden" : "idle";
      return;
    }
    this.raf = requestAnimationFrame(this.animate);
    const elapsed = this.pacer.step(now, rate);
    if (elapsed === null) return;
    if (this.paused) {
      this.host.dataset.renderState = "paused";
      return;
    }
    const cpuStart = performance.now();
    this.host.dataset.renderState = "rendering";
    this.mist.update(now / 1000);
    // Hidden tabs suspend the timeline; returning resumes the current action without a jump.
    this.jobs = this.jobs.filter((job) => !job(elapsed));
    if (!this.aimKey && !this.cameraMotion) this.controls.update();
    this.precipitation.update(elapsed);
    this.destruction.update(elapsed, this.camera);
    this.host.dataset.destruction = JSON.stringify(this.destruction.stats);
    this.updateUnits(elapsed, now / 1000);
    this.updateReticle();
    this.updateOcclusion();
    // Interior shadows follow moving actors / camera cutaways, then reuse their maps at rest.
    if (this.indoors && active) this.renderer.shadowMap.needsUpdate = true;
    this.profiler.begin();
    this.renderer.render(this.scene, this.camera);
    this.profiler.end(now, elapsed, cpuStart, this.renderMode);
  };

  private updateUnits(dt: number, time: number) {
    this.units.update(dt, this.camera, this.viewportWidth, this.viewportHeight);
    const selected = this.game.unit(this.selected);
    const rig = this.units.rig(this.selected);
    this.overlays.updateSelector(rig && selected && selected.hp > 0 ? rig.root.position : null, time);
  }

  private updateReticle() {
    const reticle = this.reticle;
    if (!reticle) return;
    reticle.hidden = !this.aimPoint || this.cameraMotion;
    if (!this.aimPoint) return;
    const p = this.aimPoint.clone().project(this.camera);
    reticle.style.left = `${(p.x * 0.5 + 0.5) * this.viewportWidth}px`;
    reticle.style.top = `${(-p.y * 0.5 + 0.5) * this.viewportHeight}px`;
  }

  /** Dense foreground blocks must not hide the focus, any living unit or the aim point. */
  private updateOcclusion() {
    const points = [this.controls.target, ...this.units.chestPoints(this.chestPoints)];
    if (this.aimPoint) points.push(this.aimPoint);
    this.host.dataset.occludedBuildings = String(this.occlusion.update(this.camera.position, points));
    this.destruction.syncBuildingVisibility(this.occlusion.occluders.map(({ group }) => group.visible));
    this.destruction.syncOfficeVisibility(this.camera.position, points);
    for (const o of this.supportedScenery) o.visible = this.destruction.isPropVisible(o.userData.supportProp);
  }

  // === Lifecycle ===

  /** Compile every shader up front, weapons included, so the first shot does not stall. */
  async warmup() {
    const restore = this.units.showAllWeapons();
    try {
      await this.renderer.compileAsync(this.scene, this.camera);
    } finally {
      restore();
    }
  }

  /** A head-and-shoulders portrait of `u` as a data URL. */
  portrait(u: Unit) {
    const studio = createPortraitStudio(this.renderer, u);
    try {
      return studio.render();
    } finally {
      studio.dispose();
      this.invalidate();
    }
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.units.dispose();
    this.destruction.dispose();
    this.precipitation.dispose();
    document.removeEventListener("visibilitychange", this.onVisibility);
    const geometries = new Set<T.BufferGeometry>(),
      materials = new Set<T.Material>(),
      textures = new Set<T.Texture>(),
      skeletons = new Set<T.Skeleton>();
    this.scene.traverse((o) => {
      if (o instanceof T.SpotLight || o instanceof T.DirectionalLight || o instanceof T.PointLight) o.dispose();
      if (o instanceof T.Mesh || o instanceof T.Line) {
        geometries.add(o.geometry);
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
        if (o instanceof T.SkinnedMesh) skeletons.add(o.skeleton);
      }
    });
    for (const m of materials) {
      for (const value of Object.values(m)) if (value instanceof T.Texture) textures.add(value);
      m.dispose();
    }
    for (const t of textures) t.dispose();
    for (const g of geometries) g.dispose();
    for (const skeleton of skeletons) skeleton.dispose();
    this.profiler.dispose();
    this.mist.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}

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
import type { ThrowOrder } from "../action-registry";
import { burstUnits } from "../targeting";
import { aimHuman, holdHuman, play } from "../humans";
import { createPortraitStudio } from "../portrait-studio";
import { renderCadence, renderPixelRatio, type RenderMode } from "../render-policy";
import { applyTimeOfDay, type TimeOfDay } from "../scene-weather";
import { Callouts, type Anchor, type Projected, type ShotResult } from "./callouts";
import { SceneClock } from "./clock";
import { Effects, reducedMotion } from "./effects";
import { Destruction } from "./destruction";
import { mapView } from "./maps";
import { Occlusion } from "./occlusion";
import { Overlays } from "./overlays";
import { RenderProfiler } from "./profiler";
import { buildCovers, buildRelay } from "./props";
import { Precipitation, RoofMap, type Weather } from "./precipitation";
import { Space } from "./space";
import type { AimReadout } from "./markers";
import { Units } from "./units";
import { ThreatOverlay } from "./threat";
import type { ThreatArea } from "../intel";
import { StreetReflections, wetGround } from "./puddles";
import { noAir, plain, shot, SHOT_STEP } from "./shot";
import { LOOK } from "./look";
import { Post } from "./post";
import { StreetAir } from "./street-air";

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

/** Metres above the boots the camera centres on an operator: the belt, not the tile. */
const FOCUS_HEIGHT = 1;

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
  /** The selected operator's id; "" with nobody selected. */
  selected = "";
  cinematic = false;
  paused = false;
  disposed = false;
  /** Resolves when the shoulder camera has settled on its target. */
  aimReady: Promise<void> = Promise.resolve();
  onPick: (p: Cell, id?: string) => void = () => {};
  onHover: (p: Cell) => void = () => {};
  /** The pointer left the field, taking the preview with it. */
  onLeave: () => void = () => {};
  /** The unit under the pointer changed (null: none); mouse and pen only. */
  onUnitHover: (id: string | null) => void = () => {};
  /** A click or tap that hit neither a unit nor the map. */
  onMiss: () => void = () => {};
  /** A touch held still on a unit: the readout pins. */
  onUnitHold: (id: string) => void = () => {};
  /** The pointer kind of the last pick: a tap and a click open the readout differently. */
  lastPointer = "mouse";
  /** Run after units and plates are placed each rendered frame (the readout follows its unit). */
  readonly frameHooks = new Set<() => void>();
  private hoveredUnit: string | null = null;
  private threat!: ThreatOverlay;

  private readonly space: Space;
  private readonly units: Units;
  private readonly overlays: Overlays;
  private readonly effects = new Effects(this);
  private readonly destruction: Destruction;
  private readonly occlusion = new Occlusion();
  private readonly reflections = new StreetReflections();
  private reflectionsDirty = true;
  private readonly precipitation: Precipitation;
  /** What the post pipeline draws over the scene with a soft depth fade: lamp light volumes, rain, snow. */
  private readonly airScene = new T.Scene();
  private readonly roof = new RoofMap();
  private roofDirty = true;
  private readonly profiler: RenderProfiler;
  private readonly reticle?: HTMLElement;
  private readonly sun = new T.DirectionalLight(0xc6d2ed, 3.6);
  private readonly ambient = new T.HemisphereLight(0xaebbd6, 0x14131a, 0.95);
  private readonly rim = new T.DirectionalLight(0xd69d70, 0.55);
  private readonly mist = perimeterMist();
  private readonly post: Post;
  private readonly air: StreetAir;
  private readonly pacer = new FramePacer();
  private readonly resizeObserver: ResizeObserver;
  private readonly chestPoints: T.Vector3[] = [];
  /** Every tween runs on it; `timeScale` sets the pace of scene animation. */
  private readonly clock = new SceneClock();
  /** Shot results popping up over their targets. */
  private readonly callouts: Callouts;
  private readonly calloutPoint = new T.Vector3();
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
  /** `?shot=`: fixed steps taken since `startShot`; -1 before it. */
  private shotStep = -1;
  private pixelRatioQuery?: MediaQueryList;
  /** The device pixel ratio the buffers were last sized for. */
  private pixelRatioSeen = 0;
  /** A display-scale change (another monitor, browser zoom) alone resizes nothing the observer sees. */
  private readonly onPixelRatio = () => {
    // The query flips before `devicePixelRatio` itself is current; read it on the next frame.
    requestAnimationFrame(() => {
      if (this.disposed) return;
      this.resize();
      this.watchPixelRatio();
    });
  };
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
    this.post = new Post(renderer);
    if (!plain) this.mist.mesh.material.uniforms.blend.value = LOOK.mistBlend;
    this.scene.background = new T.Color(0x0c1019);
    this.scene.fog = new T.FogExp2(0x252b3b, 0.019);
    renderer.setPixelRatio(1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFShadowMap;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    viewport.append(renderer.domElement);
    this.controls = this.createControls();
    this.light();
    this.space = new Space(game.map);
    this.destruction = new Destruction(game.map, () => {
      this.renderer.shadowMap.needsUpdate = true;
      // Debris and broken props are new materials: they join the street's height fog here.
      if (this.air && !this.indoors) {
        this.air.fog(this.destruction.group);
        this.host.dataset.airMaterials = String(this.air.patched);
      }
    });
    // Scenery places clones of the same catalog assets combat destroys.
    const kit = { props: this.destruction.assets };
    this.occlusion.occluders.push(...mapView(game.map.plan.id).build(this.scene, kit));
    if (!mapView(game.map.plan.id).furnishedCover) buildCovers(this.scene, this.space, kit.props);
    if (!game.scenario.noObjective) buildRelay(this.scene, this.space, game.relay);
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
    this.scene.add(
      this.destruction.group,
      this.mist.mesh,
      this.effects.light,
      this.effects.group,
    );
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    this.overlays = new Overlays(this.scene, this.space);
    const tone = (name: string, fallback: string) =>
      getComputedStyle(viewport).getPropertyValue(name).trim() || fallback;
    this.threat = new ThreatOverlay(this.scene, this.space, {
      hostile: tone("--red", "#c98177"),
      friendly: tone("--text-secondary", "#a4b5bc"),
    });
    this.callouts = new Callouts(
      { create: () => document.createElement("div"), append: (node) => labels.append(node as HTMLElement) },
      this.clock,
      reducedMotion,
      () => this.invalidate(),
    );
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
    // Outdoors the street's air goes over everything built so far: height fog and the lamps' light volumes.
    this.air = new StreetAir(
      this.scene,
      this.post.depth,
      this.roof.uniforms,
      !noAir,
    );
    this.precipitation = new Precipitation(
      { depth: this.post.depth, light: this.air.light },
      this.roof,
    );
    this.airScene.add(this.precipitation.group);
    if (!this.indoors) {
      this.air.fog(this.scene);
      if (!noAir) this.airScene.add(this.air.cones);
    }
    viewport.dataset.airMaterials = String(this.air.patched);
    this.watchPixelRatio();
    this.listen();
    // A unit's name plate counts as the unit for the readout.
    const plate = (e: PointerEvent) =>
      e.pointerType === "touch" ? undefined : (e.target as Element | null)?.closest?.<HTMLElement>("[data-unit]")?.dataset.unit;
    labels.addEventListener("pointerover", (e) => {
      const id = plate(e);
      if (id) this.hoverUnit(id);
    });
    labels.addEventListener("pointerout", (e) => {
      if (plate(e)) this.hoverUnit(null);
    });
    document.addEventListener("visibilitychange", this.onVisibility);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(viewport);
    this.resize();
    const extent = mapView(game.map.plan.id).extent;
    if (extent && !shot) {
      // A larger stage than the street's: the camera may reach its corners, the sun's shadows cover it.
      this.controls.maxTargetRadius = Math.max(13, extent);
      const reach = Math.max(22, extent + 4);
      Object.assign(this.sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach });
      this.sun.shadow.camera.far = Math.max(this.sun.shadow.camera.far, reach * 3);
      this.sun.shadow.camera.updateProjectionMatrix();
    }
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
    controls.mouseButtons = {
      LEFT: T.MOUSE.ROTATE,
      MIDDLE: T.MOUSE.DOLLY,
      RIGHT: T.MOUSE.PAN,
    };
    if (shot) {
      // Dev only: a pinned camera that no input, focus or damping moves, free of the orbit limits.
      controls.minDistance = 0;
      controls.maxPolarAngle = Math.PI;
      controls.maxTargetRadius = Infinity;
      this.camera.position.set(...shot.position);
      this.camera.fov = shot.fov;
      controls.target.set(...shot.target);
      controls.enableDamping = false;
      controls.enabled = false;
      this.cameraMotion = true;
    }
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
    sun.shadow.mapSize.set(LOOK.shadow.size, LOOK.shadow.size);
    sun.shadow.radius = LOOK.shadow.radius;
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
    // A touch held still on a unit pins its readout; the release is then not a pick.
    let press = 0;
    let pressed = false;
    host.addEventListener("pointerdown", (e) => {
      down = [e.clientX, e.clientY];
      pressed = false;
      clearTimeout(press);
      if (e.pointerType === "touch") {
        const id = this.unitAtScreen(e.clientX, e.clientY);
        if (id)
          press = window.setTimeout(() => {
            pressed = true;
            this.onUnitHold(id);
          }, 450);
      }
      this.invalidate();
    });
    host.addEventListener("pointercancel", () => clearTimeout(press));
    host.addEventListener("pointerup", (e) => {
      clearTimeout(press);
      if (pressed) return;
      this.lastPointer = e.pointerType;
      if (e.button !== 0 || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
      const ray = this.pointerRay(e);
      const unit = this.units.pick(ray);
      if (unit) {
        this.onPick(unit.pos, unit.id);
        return;
      }
      const p = this.pick(e, ray);
      if (p) this.onPick(p, this.game.units.find((u) => u.hp > 0 && key(u.pos) === key(p))?.id);
      else this.onMiss();
    });
    host.addEventListener("pointermove", (e) => {
      if (e.pointerType === "touch" && Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 8) clearTimeout(press);
      if (e.buttons || this.draggingCamera || this.cameraMotion || this.aimKey) return;
      if (e.pointerType !== "touch") this.hoverUnit(this.unitAtScreen(e.clientX, e.clientY));
      const p = this.pick(e);
      if (p && this.overlays.hoverAt(p)) {
        this.invalidate();
        this.onHover(p);
      } else if (!p && this.overlays.leave()) {
        this.onLeave();
        this.invalidate();
      }
    });
    host.addEventListener("pointerleave", () => {
      this.hoverUnit(null);
      this.overlays.leave();
      this.onLeave();
      this.invalidate();
    });
  }

  private hoverUnit(id: string | null) {
    if (id === this.hoveredUnit) return;
    this.hoveredUnit = id;
    this.onUnitHover(id);
  }

  /**
   * A unit's body on screen, in CSS pixels within the viewport: from the boots
   * to over the head, as wide as a standing figure. Null when it is behind the
   * camera, down, or not loaded. Projection only — no raycast, cheap enough
   * for every pointer move.
   */
  unitBox(id: string): { x: number; y: number; w: number; h: number } | null {
    const u = this.game.unit(id);
    const rig = this.units.rig(id);
    if (!u || u.hp <= 0 || !rig) return null;
    const feet = this.boxPoint.copy(rig.root.position).project(this.camera);
    if (feet.z > 1) return null;
    const fx = (feet.x * 0.5 + 0.5) * this.viewportWidth,
      fy = (-feet.y * 0.5 + 0.5) * this.viewportHeight;
    const head = this.boxPoint.copy(rig.root.position).setY(rig.root.position.y + 1.9).project(this.camera);
    const hx = (head.x * 0.5 + 0.5) * this.viewportWidth,
      hy = (-head.y * 0.5 + 0.5) * this.viewportHeight;
    const h = Math.max(12, fy - hy);
    const w = h * 0.42;
    return { x: (fx + hx) / 2 - w / 2, y: hy, w, h };
  }
  private readonly boxPoint = new T.Vector3();

  /** A living unit's horizontal screen position, undefined when it is out of view. */
  screenX(id: string): number | undefined {
    const box = this.unitBox(id);
    if (!box) return undefined;
    const x = box.x + box.w / 2,
      y = box.y + box.h / 2;
    return x < 0 || x > this.viewportWidth || y < 0 || y > this.viewportHeight ? undefined : x;
  }

  get viewSize() {
    return { w: this.viewportWidth, h: this.viewportHeight };
  }

  /** The living unit whose body is under a client point, the nearest to the camera first. */
  unitAtScreen(clientX: number, clientY: number): string | null {
    const rect = this.host.getBoundingClientRect();
    const x = clientX - rect.left,
      y = clientY - rect.top;
    let best: string | null = null,
      nearest = Infinity;
    for (const u of this.game.units) {
      const box = this.unitBox(u.id);
      if (!box) continue;
      // A far-off figure is a few pixels wide: the target is never smaller than a fingertip.
      const w = Math.max(box.w + 8, 28),
        h = Math.max(box.h + 8, 44);
      const cx = box.x + box.w / 2,
        cy = box.y + box.h / 2;
      if (Math.abs(x - cx) > w / 2 || Math.abs(y - cy) > h / 2) continue;
      const d = this.units.rig(u.id)!.root.position.distanceToSquared(this.camera.position);
      if (d < nearest) [best, nearest] = [u.id, d];
    }
    return best;
  }

  /** The inspected unit's reach on the ground; null clears. */
  showThreat(area: ThreatArea | null, hostile = true) {
    this.threat.show(area, hostile);
    this.invalidate();
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

  /** Re-run `resize` when the device pixel ratio moves off its current value; re-armed on every change. */
  private watchPixelRatio() {
    this.pixelRatioQuery?.removeEventListener("change", this.onPixelRatio);
    if (this.disposed || typeof matchMedia !== "function") return;
    this.pixelRatioQuery = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
    this.pixelRatioQuery.addEventListener("change", this.onPixelRatio);
  }

  resize() {
    const { width, height } = this.host.getBoundingClientRect();
    if (!width || !height) return;
    this.viewportWidth = width;
    this.viewportHeight = height;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.pixelRatioSeen = devicePixelRatio;
    this.renderer.setPixelRatio(
      renderPixelRatio(width, height, devicePixelRatio, this.renderMode),
    );
    this.renderer.setSize(width, height);
    this.post.resize();
    this.precipitation.setViewportHeight(
      height * this.renderer.getPixelRatio(),
      this.camera,
    );
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

  showRange(u: Unit | undefined, show: boolean) {
    this.overlays.showRange(this.game, u, show);
  }

  /** Tiles within throwing distance of `u`, for the grenade of `kind` (all share the range). */
  showGrenadeRange(u: Unit, kind: ThrowOrder = "grenade") {
    this.overlays.showGrenadeRange(u, kind);
  }

  /** The planned route, or a throw's arc and burst with every unit it would catch marked when `grenade`. */
  showPath(path: Cell[] | undefined, grenade = false) {
    this.overlays.showPath(path, grenade, grenade && path?.length ? burstUnits(this.game, path[path.length - 1]).map((u) => u.pos) : []);
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

  /** The hover tile on `p`, or hidden on null; renders only on a change. */
  markTile(p: Cell | null) {
    const moved = !!p && this.overlays.hoverAt(p);
    if (!moved && this.overlays.hoverVisible === !!p) return;
    this.overlays.setHover(!!p);
    this.invalidate();
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
    target.y += FOCUS_HEIGHT;
    const offset = this.camera.position.clone().sub(this.controls.target);
    const from = this.controls.target.clone();
    this.tween(0.6, (t) => {
      this.controls.target.copy(from).lerp(target, t);
      this.camera.position.copy(this.controls.target).add(offset);
    }, true, true);
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
   * Slide the view over the field, the focus and the camera together:
   * `right` and `forward` are screen directions in fractions of the camera's
   * distance to its focus, so a stick pans at one on-screen pace at any zoom.
   */
  pan(right: number, forward: number) {
    if (this.aimKey || this.cameraMotion) return;
    const f = this.controls.target.clone().sub(this.camera.position);
    const reach = f.length();
    f.setY(0).normalize();
    const step = new T.Vector3(-f.z, 0, f.x).multiplyScalar(right * reach).addScaledVector(f, forward * reach);
    this.controls.target.add(step);
    this.camera.position.add(step);
    this.controls.update();
    this.invalidate();
  }

  /** Tip the camera toward overhead (`angle` > 0) or the horizon, within the controls' limits. */
  tilt(angle: number) {
    if (this.aimKey || this.cameraMotion) return;
    const { controls } = this;
    const orbit = new T.Spherical().setFromVector3(this.camera.position.clone().sub(controls.target));
    orbit.phi = T.MathUtils.clamp(orbit.phi - angle, controls.minPolarAngle, controls.maxPolarAngle);
    this.camera.position.setFromSpherical(orbit).add(controls.target);
    controls.update();
    this.invalidate();
  }

  /** The cell under the camera's focus, or null off the map. */
  focusCell(): Cell | null {
    return this.space.cellAt(this.controls.target);
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

  /** Close camera on the selected operator (on the focus, with nobody selected), or the tactical overview. */
  view(cinematic: boolean) {
    this.cinematic = cinematic;
    const rig = this.units.rig(this.selected);
    const target = !cinematic
      ? new T.Vector3(0, 0, -0.3)
      : rig
        ? rig.root.position.clone().add(new T.Vector3(0, 0.7, 0))
        : this.controls.target.clone();
    const position = target.clone().add(cinematic ? new T.Vector3(6, 3.5, 6) : new T.Vector3(22, 25, 28));
    const start = this.camera.position.clone(),
      startTarget = this.controls.target.clone();
    this.tween(0.85, (t) => {
      this.camera.position.copy(start).lerp(position, t);
      this.controls.target.copy(startTarget).lerp(target, t);
    }, true, true);
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

  /**
   * Run `fn` from 0 to 1 over `seconds` of scene time, eased unless `smooth` is
   * false. `real` runs on frame time whatever `timeScale` is: the viewer's own
   * camera moves (focus, the view toggle), never an event's animation.
   */
  tween(seconds: number, fn: (t: number) => void, smooth = true, real = false) {
    this.invalidate();
    return this.clock.tween(seconds, fn, smooth, real);
  }

  /**
   * Scene time per frame time, for every animation an event plays (bodies,
   * effects, debris, the action camera); rain, mist and the viewer's own camera
   * keep real time. 1 as played; a replay sets 0.5–4, and 0 holds the field.
   */
  get timeScale() {
    return this.clock.timeScale;
  }

  set timeScale(scale: number) {
    this.clock.timeScale = Math.max(0, scale);
    this.pacer.reset();
    this.invalidate();
  }

  /** Every animation running now played to its end at once, until `done` settles (a replay's seek). */
  async finish(done: Promise<unknown>) {
    await this.clock.finish(done);
    this.invalidate();
  }

  /** Out of the shoulder camera at once, back to the camera saved before it: a seek leaves no aim behind. */
  dropAim() {
    const saved = this.savedCamera;
    this.savedCamera = null;
    this.aimKey = "";
    this.aimUnit = "";
    this.aimPoint = null;
    ++this.cameraSequence;
    this.cameraMotion = false;
    this.aimReady = Promise.resolve();
    if (saved) {
      this.camera.position.copy(saved.position);
      this.controls.target.copy(saved.target);
      this.camera.fov = saved.fov;
      this.camera.updateProjectionMatrix();
    }
    this.controls.enabled = !shot;
    this.host.dataset.cameraReady = "true";
    this.host.dataset.cameraMode = this.cinematic ? "close" : "tactical";
    this.controls.update();
    this.invalidate();
  }

  /** Animate an event the rules emitted; events with no motion resolve at once. */
  async play(event: GameEvent) {
    const unit = (id: string) => this.game.unit(id)!;
    switch (event.type) {
      case "move":
        return this.units.move(unit(event.unit), event.path);
      case "shot":
        return this.shot(unit(event.unit), unit(event.target), event.hit, event.environment ?? [], event);
      case "reload":
        return this.units.reload(unit(event.unit));
      case "grenade":
        return this.throwAt(unit(event.unit), event.at, event.environment ?? [], undefined, "grenade", event.casualties);
      case "flashbang":
      case "smoke-grenade":
        return this.throwAt(unit(event.unit), event.at, [], undefined, event.type);
      case "hunker":
        return this.units.hunker(unit(event.unit));
      case "overwatch":
        return this.units.watch(unit(event.unit));
    }
  }

  /** A shot fired ahead of its outcome: the target reacts once `hit` is known. */
  fire(a: Unit, b: Unit, hit: Promise<boolean>, result?: Promise<ShotResult | null>) {
    return this.shot(a, b, hit, [], result);
  }

  /** A grenade of `kind` thrown and gone off; whoever it hurt reacts once `settled`. */
  throwAt(
    u: Unit,
    at: Cell,
    environment: PropDamage[],
    settled?: Promise<unknown>,
    kind: ThrowOrder = "grenade",
    casualties: { unit: string; damage: number }[] = [],
  ) {
    return this.units.grenade(
      u,
      at,
      () => {
        this.destruction.apply(environment, this.space.vec(at, 0.2));
        for (const c of casualties) this.callout({ hit: true, damage: c.damage }, c.unit);
        this.invalidate();
      },
      settled,
      kind,
    );
  }

  /** A shot, with a camera kick on each tracer when it is framed over the shooter's shoulder. */
  private shot(
    a: Unit,
    b: Unit,
    hit: boolean | Promise<boolean>,
    environment: PropDamage[],
    result?: ShotResult | null | Promise<ShotResult | null>,
  ) {
    const shoulder = this.aimUnit === a.id;
    const kick = a.weapon === "sniper" ? 0.11 : 0.035;
    // The shoulder camera is settled before the trigger is pulled; each kick returns to it.
    const origin = this.camera.position.clone();
    let impacted = false;
    let called = false;
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
        if (result && !called) {
          // The first tracer is the impact; a result still on its way shows when it arrives.
          called = true;
          void Promise.resolve(result).then((r) => r && this.callout(r, b.id));
        }
        if (!impacted && environment.length) {
          this.destruction.apply(environment, this.space.vec(a.pos, 1));
          impacted = true;
        }
        if (shoulder) this.camera.position.copy(origin);
      },
    });
  }

  /** A shot result over `unit` (its rig's root is the anchor, so it follows the body). */
  private callout(result: ShotResult, unit: string) {
    const rig = this.units.rig(unit);
    if (rig) this.callouts.show(result, unit, rig.root.position);
  }

  /** Where `anchor` (lifted `lift` metres) is on the field, in pixels. */
  private readonly project = (anchor: Anchor, lift: number, out: Projected) => {
    const p = this.calloutPoint.set(anchor.x, anchor.y + lift, anchor.z).project(this.camera);
    out.visible = p.z <= 1 && Math.abs(p.x) <= 1.2 && Math.abs(p.y) <= 1.2;
    out.x = (p.x * 0.5 + 0.5) * this.viewportWidth;
    out.y = (-p.y * 0.5 + 0.5) * this.viewportHeight;
  };

  /** Swap in a fresh encounter: every rig out of its pose and back on its start cell. */
  redeploy(game: Encounter) {
    this.game = game;
    this.space.map = game.map;
    this.destruction.reset(game.map);
    this.units.redeploy();
    this.callouts.clear();
    this.invalidate();
  }

  /**
   * Swap in an encounter rebuilt to any point of its game, with no animation:
   * the props as its map has them, every unit on its cell in its resting pose,
   * the fallen already down, the smoke where it lingers. A replay's seek.
   */
  rebuild(game: Encounter) {
    this.dropAim();
    this.game = game;
    this.space.map = game.map;
    this.destruction.reset(game.map);
    this.units.snap(this.selected);
    this.callouts.clear();
    this.host.dataset.smoke = this.effects.lingeringIds.join(",");
    this.reflectionsDirty = true;
    this.invalidate();
  }

  /** Bring rigs and markers in line with the encounter after the rules changed it. */
  sync() {
    if (this.units.sync(this.selected, !!this.aimKey)) this.invalidate();
    this.host.dataset.smoke = this.effects.lingeringIds.join(",");
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
      this.renderer.toneMappingExposure = interior(
        this.scene,
        this.sun,
        this.ambient,
        this.rim,
        time,
      );
      this.post.setDaylight(false);
    } else {
      const p = applyTimeOfDay(
        this.scene,
        this.sun,
        this.ambient,
        this.rim,
        time,
      );
      const exposure = mapView(this.game.map.plan.id).tune?.(this.scene, this.sun, this.ambient, this.rim, time);
      if (this.precipitation.kind === "snow") {
        // Snow in the air scatters light: paler, slightly thicker fog and more light from the sky.
        const fog = this.scene.fog as T.FogExp2,
          { air } = LOOK.snow;
        fog.color.lerp(new T.Color(air.haze), air.lift);
        fog.density *= air.density;
        this.ambient.intensity *= air.ambient;
      }
      this.renderer.toneMappingExposure = exposure ?? p.exposure;
      this.mist.mesh.material.uniforms.tint.value.setHex(p.mist);
      this.air.setLit(p.lights, this.scene);
      this.post.setDaylight(!p.lights);
      this.precipitation.setAmbient(this.scene.fog!.color);
    }
    this.renderer.shadowMap.needsUpdate = true;
    this.reflectionsDirty = true;
    this.host.dataset.timeOfDay = time;
    this.invalidate();
  }

  get weather() { return this.precipitation.kind; }

  get indoors() { return !!mapView(this.game.map.plan.id).interiorLighting; }

  setWeather(weather: Weather) {
    // Weather is an outdoor thing: nothing falls inside a building.
    this.precipitation.setKind(this.indoors || noAir ? "clear" : weather);
    const kind = this.precipitation.kind;
    // The ground follows the weather: ripples only in rain, a dusting over a dulled street in snow.
    wetGround.rippleAmount.value = kind === "rain" ? LOOK.rain.ripples : 0;
    wetGround.wetAmount.value = kind === "snow" ? LOOK.snow.wet : 1;
    this.air.setSnow(kind === "snow");
    // The air does too (fog, sky light, the probe): re-apply the time of day under the new weather.
    if (!this.indoors) this.setTimeOfDay(this.timeOfDay);
    this.host.dataset.weather = weather;
    this.host.dataset.snowParticles = String(this.precipitation.particles);
    this.invalidate();
  }

  setRenderMode(mode: RenderMode) {
    this.renderMode = mode;
    this.post.setMode(mode);
    this.destruction.setBatterySaver(mode === "battery");
    this.precipitation.setBatterySaver(mode === "battery");
    this.host.dataset.snowParticles = String(this.precipitation.particles);
    this.resize();
  }

  /** `?shot=`: the encounter is ready; count the fixed steps to the held frame from here. */
  startShot() {
    this.shotStep = 0;
    this.invalidate();
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
    // A held clock (a paused replay) moves nothing: it draws only when the view changes.
    const held = this.clock.timeScale === 0;
    const active =
      now < this.activeUntil ||
      this.clock.moving ||
      (this.units.busy && !held) ||
      (this.destruction.active && !held) ||
      this.occlusion.active ||
      this.destruction.fading ||
      (!!shot && this.shotStep <= shot.frames);
    const rate = renderCadence(this.renderMode, !document.hidden, active);
    if (rate === null) {
      this.pacer.reset();
      this.host.dataset.renderState = document.hidden ? "hidden" : "idle";
      return;
    }
    this.raf = requestAnimationFrame(this.animate);
    let elapsed = this.pacer.step(now, rate);
    if (elapsed === null) return;
    if (shot) {
      // Scene time stands still until `startShot`, runs in fixed steps, then the frame is held.
      if (this.shotStep > shot.frames) return;
      elapsed = this.shotStep < 0 ? 0 : SHOT_STEP;
      now = Math.max(0, this.shotStep) * SHOT_STEP * 1000;
      if (this.shotStep >= 0) this.shotStep++;
    }
    if (this.paused) {
      this.host.dataset.renderState = "paused";
      return;
    }
    const cpuStart = performance.now();
    // Belt and braces for the media-query listener: a frame never draws at a stale pixel ratio.
    if (devicePixelRatio !== this.pixelRatioSeen) this.resize();
    this.host.dataset.renderState = "rendering";
    this.mist.update(now / 1000);
    this.air.update(now / 1000);
    // Hidden tabs suspend the timeline; returning resumes the current action without a jump.
    this.clock.step(elapsed);
    const sceneElapsed = this.clock.scaled(elapsed);
    if (!this.aimKey && !this.cameraMotion) this.controls.update();
    this.precipitation.update(elapsed);
    this.precipitation.follow(this.controls.target);
    wetGround.rippleTime.value = this.precipitation.time;
    this.destruction.update(sceneElapsed, this.camera);
    this.host.dataset.destruction = JSON.stringify(this.destruction.stats);
    this.updateUnits(sceneElapsed, now / 1000);
    for (const hook of this.frameHooks) hook();
    this.updateReticle();
    if ((this.reflectionsDirty || this.roofDirty) && !this.indoors) {
      // Probe only scenery: moving actors and ground HUD should never be baked into puddles.
      const excluded = [
        ...this.overlays.reflectionExcluded,
        this.threat.object,
        this.effects.group,
        ...this.game.units.flatMap((u) => {
          const rig = this.units.rig(u.id);
          return rig ? [rig.root] : [];
        }),
      ];
      const excludedVisibility = excluded.map((object) => object.visible);
      excluded.forEach((object) => { object.visible = false; });
      const visibility = this.occlusion.occluders.map(({ group }) => group.visible);
      for (const { group } of this.occlusion.occluders) group.visible = true;
      if (this.roofDirty) {
        // The weather's roof map: static scenery only, so props and mist come out too.
        const extra = [this.destruction.group, this.mist.mesh],
          shown = extra.map((object) => object.visible);
        extra.forEach((object) => {
          object.visible = false;
        });
        try {
          this.roof.capture(this.renderer, this.scene);
        } finally {
          extra.forEach((object, i) => {
            object.visible = shown[i];
          });
        }
        this.roofDirty = false;
      }
      // The probe never lights its own capture; afterwards it is also the scene's faint environment.
      this.scene.environment = null;
      try {
        if (this.reflectionsDirty)
          this.reflections.capture(this.renderer, this.scene);
      } finally {
        this.scene.environment = this.reflections.texture;
        this.scene.environmentIntensity = LOOK.environment;
        excluded.forEach((object, i) => {
          object.visible = excludedVisibility[i];
        });
        this.occlusion.occluders.forEach(({ group }, i) => {
          group.visible = visibility[i];
        });
      }
      this.reflectionsDirty = false;
    }
    this.updateOcclusion(elapsed);
    // Interior shadows follow moving actors / camera cutaways, then reuse their maps at rest.
    if (this.indoors && active) this.renderer.shadowMap.needsUpdate = true;
    this.profiler.begin();
    if (plain) this.renderer.render(this.scene, this.camera);
    else
      this.post.render(
        this.scene,
        this.camera,
        noAir ? undefined : this.airScene,
      );
    this.profiler.end(now, elapsed, cpuStart, this.renderMode);
    if (shot && this.shotStep > shot.frames) this.host.dataset.shot = "ready";
  };

  private updateUnits(dt: number, time: number) {
    this.units.update(dt, this.camera, this.viewportWidth, this.viewportHeight);
    if (this.callouts.count) this.callouts.place(this.viewportWidth, this.viewportHeight, this.project);
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

  /** Update scenery visibility against the camera focus, living units and aim point. */
  private updateOcclusion(dt: number) {
    const points = [this.controls.target, ...this.units.chestPoints(this.chestPoints)];
    if (this.aimPoint) points.push(this.aimPoint);
    const wasFading = this.occlusion.active;
    this.host.dataset.occludedBuildings = String(this.occlusion.update(this.camera.position, points, dt));
    if (wasFading || this.occlusion.active) this.renderer.shadowMap.needsUpdate = true;
    this.destruction.syncBuildingVisibility(this.occlusion.occluders.map(({ group }) => this.occlusion.amount(group)));
    this.destruction.syncOfficeVisibility(this.camera.position, points, dt);
    for (const o of this.supportedScenery) o.visible = this.destruction.isPropVisible(o.userData.supportProp);
  }

  // === Lifecycle ===

  /** Temporarily show all weapons, compile scene shaders, then restore weapon visibility. */
  async warmup() {
    const restore = this.units.showAllWeapons();
    try {
      await this.post.compiling(() =>
        this.renderer.compileAsync(this.scene, this.camera),
      );
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
    this.pixelRatioQuery?.removeEventListener("change", this.onPixelRatio);
    this.controls.dispose();
    this.callouts.clear();
    this.units.dispose();
    this.occlusion.dispose();
    this.reflections.dispose();
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
    this.air.dispose();
    this.roof.dispose();
    this.post.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}

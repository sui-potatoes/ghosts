import { escapeHTML } from "./html";
import {shortestAngle,shoulderArc} from './aim-transition';
import {coverPeek,coverStep,physicalCover,wallTravel,coverStance} from './high-cover';
import { applyTimeOfDay, type TimeOfDay } from "./scene-weather";
import { buildDistrict, districtGrid } from "./district";
import { surfaceHeight } from "./district-plan";
import { createPortraitStudio } from "./portrait-studio";
import { vaultProgress } from "./vault-motion";
import { aimClip } from "./combat-pose";
import { perimeterMist } from "./atmosphere";
import { FramePacer } from "./frame-pacer";
import {
  soldier,
  aimHuman,
  restHuman,
  holdHuman,
  play,
  setWeapon as equipHuman,
  updateHuman,
  type Rig,
} from "./humans";
import * as T from "three";
import {
  fireMotion,
  reloadMotion,
  reactionMotion,
  type Motion,
} from "./motions";

import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { batchStaticScenery } from "./batching";
import {
  renderCadence,
  renderPixelRatio,
  type RenderMode,
} from "./render-policy";
import {
  Encounter,
  covers,
  relay,
  SIZE,
  key,
  type Cell,
  type Unit,
  type Weapon,
} from "./game";
const S = 1.35;
const vec = (p: Cell, y = 0) => new T.Vector3(p[0] * S, y + surfaceHeight(p[0] * S, p[1] * S), p[1] * S);
const palette = {
  concrete: 0x343842,
  edge: 0x626672,
  metal: 0x242833,
  black: 0x11151e,
  amber: 0xf6bd64,
  cyan: 0x78bac2,
  red: 0xf45f53,
};
const materialCache = new Map<string, T.MeshStandardMaterial>();
const mat = (
  color: T.ColorRepresentation,
  metalness = 0.35,
  roughness = 0.65,
) => {
  const key = `${color}:${metalness}:${roughness}`;
  if (!materialCache.has(key))
    materialCache.set(
      key,
      new T.MeshStandardMaterial({ color, metalness, roughness }),
    );
  return materialCache.get(key)!;
};
const concrete = mat(palette.concrete),
  edge = mat(palette.edge),
  metal = mat(palette.metal, 0.75, 0.3),
  dark = mat(palette.black),
  amber = new T.MeshStandardMaterial({
    color: 0xffc476,
    emissive: 0xff9b33,
    emissiveIntensity: 2.4,
  }),
  cyan = new T.MeshStandardMaterial({
    color: 0xd8e2ff,
    emissive: 0x829bdf,
    emissiveIntensity: 2.1,
  });
const cube = new T.BoxGeometry(1, 1, 1);

function box(
  parent: T.Object3D,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  m: T.Material = concrete,
) {
  const o = new T.Mesh(cube, m);
  o.position.set(x, y, z);
  o.scale.set(w, h, d);
  o.castShadow = true;
  o.receiveShadow = true;
  parent.add(o);
  return o;
}
function cyl(
  parent: T.Object3D,
  x: number,
  y: number,
  z: number,
  r: number,
  h: number,
  m: T.Material = metal,
) {
  const o = new T.Mesh(new T.CylinderGeometry(r, r, h, 10), m);
  o.position.set(x, y, z);
  o.castShadow = true;
  parent.add(o);
  return o;
}
let seed = 44;
function random() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}
export class Battlefield {
  scene = new T.Scene();
  camera = new T.PerspectiveCamera(39, 1, 0.1, 180);
  renderer: T.WebGLRenderer;
  controls: OrbitControls;
  renderMode: RenderMode = "battery";
  timeOfDay: TimeOfDay = "night";
  private sun = new T.DirectionalLight(0xc6d2ed, 3.6);
  private ambient = new T.HemisphereLight(0xaebbd6, 0x14131a, .95);
  private rim = new T.DirectionalLight(0xd69d70, .55);
  private pacer = new FramePacer();
  private mist = perimeterMist();
  private occluders: { group: T.Group; bounds: T.Box3 }[] = [];
  private occlusionRay = new T.Ray();
  private occlusionHit = new T.Vector3();
  private occlusionDirection = new T.Vector3();
  private occlusionSamples: T.Vector3[] = [];
  private draggingCamera = false;
  private viewportWidth = 1;
  private viewportHeight = 1;
  private movementPaths = new Map<string, Cell[]>();
  private lastMetrics = 0;
  private readonly labelOffset = new T.Vector3(0, 2.05, 0);
  private activeUntil = 0;
  private frameCount = 0;
  private profileSamples: number[][] = [];
  private profileEnabled = new URLSearchParams(location.search).has("profile");
  private profileLast = 0;
  private gpuExtension: {
    TIME_ELAPSED_EXT: number;
    GPU_DISJOINT_EXT: number;
  } | null = null;
  private gpuQuery: WebGLQuery | null = null;
  private gpuSamples: number[] = [];
  private hoverKey = "";
  private contactShadows = new Map<string, T.Mesh>();
  private effectLight = new T.PointLight(0xffbc70, 0, 12);
  private labelPoint = new T.Vector3();
  private onVisibility = () => {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.pacer.reset();
    this.host.dataset.renderState = document.hidden ? "hidden" : "awake";
    if (!document.hidden) this.invalidate();
  };
  rigs = new Map<string, Rig>();
  labels = new Map<string, HTMLButtonElement>();
  range = new T.Group();
  route = new T.Group();
  fx = new T.Group();
  selector: T.Mesh;
  hover: T.Mesh;
  rain: T.LineSegments;
  rainArray: Float32Array;
  jobs: ((dt: number) => boolean)[] = [];
  selected = "v";
  grid: T.LineSegments;
  gridVisible = true;
  cinematic = false;
  aimReady: Promise<void> = Promise.resolve();
  private aimKey = "";
  private aimUnit = "";
  private aimPoint: T.Vector3 | null = null;
  private cameraMotion = false;
  private cameraSequence = 0;
  private savedCamera: {
    position: T.Vector3;
    target: T.Vector3;
    fov: number;
  } | null = null;
  paused = false;
  onPick: (p: Cell, id?: string) => void = () => {};
  onHover: (p: Cell) => void = () => {};
  disposed = false;
  private raf = 0;
  private resizeObserver: ResizeObserver;
  static createRenderer() {
    return new T.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "low-power",
    });
  }
  constructor(
    public host: HTMLElement,
    public labelHost: HTMLElement,
    public game: Encounter,
    renderer: T.WebGLRenderer = Battlefield.createRenderer(),
  ) {
    this.scene.background = new T.Color(0x0c1019);
    this.scene.fog = new T.FogExp2(0x252b3b, 0.019);
    this.renderer = renderer;
    if (this.profileEnabled)
      this.gpuExtension = renderer
        .getContext()
        .getExtension("EXT_disjoint_timer_query_webgl2");
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    host.append(this.renderer.domElement);
    this.camera.position.set(22, 25, 28);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0, -0.3);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.15;
    this.controls.minDistance = 9;
    this.controls.maxDistance = 52;
    this.controls.minPolarAngle = 0.15;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.maxTargetRadius = 13;
    this.controls.mouseButtons = {
      LEFT: T.MOUSE.ROTATE,
      MIDDLE: T.MOUSE.DOLLY,
      RIGHT: T.MOUSE.PAN,
    };
    this.controls.update();
    this.scene.add(this.ambient);
    const sun = this.sun;
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
    const rim = this.rim;
    rim.position.set(15, 8, -10);
    this.scene.add(rim);
    this.environment();
    for (const { group } of this.occluders) group.removeFromParent();
    batchStaticScenery(this.scene);
    for (const { group } of this.occluders) {
      batchStaticScenery(group);
      group.position.set(0, 0, 0);
      group.quaternion.identity();
      this.scene.add(group);
    }
    this.scene.add(this.mist.mesh);
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.scene.add(this.effectLight);
    this.controls.addEventListener("change", () => this.invalidate());
    this.controls.addEventListener("start", () => {
      this.draggingCamera = true;
      this.invalidate();
    });
    this.controls.addEventListener("end", () => {
      this.draggingCamera = false;
      this.invalidate();
    });
    document.addEventListener("visibilitychange", this.onVisibility);
    this.scene.add(this.range, this.route, this.fx);
    this.grid = districtGrid();
    this.grid.visible = this.gridVisible;
    this.scene.add(this.grid);
    this.selector = new T.Mesh(
      new T.RingGeometry(0.48, 0.54, 48),
      new T.MeshBasicMaterial({ color: 0xe9c58a, side: T.DoubleSide }),
    );
    this.selector.rotation.x = -Math.PI / 2;
    this.scene.add(this.selector);
    this.hover = new T.Mesh(
      new T.PlaneGeometry(S * 0.92, S * 0.92),
      new T.MeshBasicMaterial({
        color: 0xe8c17d,
        transparent: true,
        opacity: 0.24,
        side: T.DoubleSide,
        depthWrite: false,
      }),
    );
    this.hover.rotation.x = -Math.PI / 2;
    this.scene.add(this.hover);
    this.hover.visible = false;
    this.rainArray = new Float32Array(650 * 6);
    for (let i = 0; i < 650; i++) {
      const x = (random() - 0.5) * 65,
        y = random() * 23,
        z = (random() - 0.5) * 55;
      this.rainArray.set([x, y, z, x - 0.12, y + 0.65, z + 0.03], i * 6);
    }
    const rg = new T.BufferGeometry();
    rg.setAttribute("position", new T.BufferAttribute(this.rainArray, 3));
    this.rain = new T.LineSegments(
      rg,
      new T.LineBasicMaterial({
        color: 0xa7c3c9,
        transparent: true,
        opacity: 0.17,
        depthWrite: false,
      }),
    );
    this.scene.add(this.rain);
    const contactGeometry = new T.CircleGeometry(0.42, 20);
    const contactMaterial = new T.MeshBasicMaterial({
      color: 0x020708,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    });
    for (const u of game.units) {
      const r = soldier(u);
      r.root.position.copy(vec(u.pos));
      const opponent = game.units
        .filter((v) => v.enemy !== u.enemy)
        .sort(
          (a, b) =>
            vec(a.pos).distanceToSquared(r.root.position) -
            vec(b.pos).distanceToSquared(r.root.position),
        )[0];
      r.root.rotation.y = Math.atan2(
        u.pos[0] - opponent.pos[0],
        u.pos[1] - opponent.pos[1],
      );
      this.scene.add(r.root);
      this.rigs.set(u.id, r);
      const contact = new T.Mesh(contactGeometry, contactMaterial);
      contact.rotation.x = -Math.PI / 2;
      contact.scale.y = 0.7;
      this.contactShadows.set(u.id, contact);
      this.scene.add(contact);
      const l = document.createElement("button");
      l.className = `unit-label ${u.enemy ? "hostile" : ""}`;
      l.setAttribute("aria-label", `Select ${u.name}`);
      l.innerHTML = `<span>${u.enemy ? "◇" : "◆"} ${escapeHTML(u.name)}</span><i></i>`;
      l.onclick = () => {
        const current = this.game.units.find((unit) => unit.id === u.id);
        if (current) this.onPick(current.pos, current.id);
      };
      labelHost.append(l);
      this.labels.set(u.id, l);
    }
    let down = [0, 0];
    host.addEventListener("pointerdown", (e) => {
      down = [e.clientX, e.clientY];
      this.invalidate();
    });
    host.addEventListener("pointerup", (e) => {
      if (
        e.button !== 0 ||
        Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5
      )
        return;
      const p = this.pick(e);
      if (p)
        this.onPick(
          p,
          this.game.units.find((u) => u.hp > 0 && key(u.pos) === key(p))?.id,
        );
    });
    host.addEventListener("pointermove", (e) => {
      if (e.buttons || this.draggingCamera || this.cameraMotion || this.aimKey)
        return;
      const p = this.pick(e);
      if (p && key(p) !== this.hoverKey) {
        this.hoverKey = key(p);
        this.invalidate();
        this.hover.position.copy(vec(p, 0.07));
        this.onHover(p);
      }
    });
    host.addEventListener("pointerleave", () => {
      this.hover.visible = false;
      this.hoverKey = "";
      this.invalidate();
    });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    this.invalidate();
  }
  environment() {
    this.occluders.push(...buildDistrict(this.scene));
    for (const [x, z] of covers) {
      const g = new T.Group();
      g.position.copy(vec([x, z]));
      this.scene.add(g);
      const barrier = new T.BoxGeometry(1.22, .86, .66);
      const positions = barrier.attributes.position;
      for (let i=0;i<positions.count;i++) if(positions.getY(i)>0) positions.setZ(i, positions.getZ(i)*.4);
      barrier.computeVertexNormals();
      const body = new T.Mesh(barrier, mat(0x8f918d, .03, .94));
      body.position.y=.47; body.castShadow=true;body.receiveShadow=true;g.add(body);
      box(g, 0, .09, 0, 1.3, .18, .72, mat(0x7b7f7d,.03,.94));
      for(const side of [-1,1]) {
        box(g,0,.77,side*.143,1.15,.18,.025,mat(0xdd9b38,.05,.7));
        for(let j=0;j<5;j++) box(g,-.45+j*.225,.77,side*.161,.075,.17,.015,dark).rotation.z=-.45;
      }
      for(const n of [-1,1])box(g,n*.43,.94,0,.09,.08,.1,amber);
    }
    const station = new T.Group();
    station.position.copy(vec(relay));
    this.scene.add(station);
    cyl(station, 0, 0.15, 0, 0.6, 0.3, metal);
    box(station, 0, 0.8, 0, 0.55, 1.3, 0.55, dark);
    box(station, 0, 1.13, 0.285, 0.4, 0.52, 0.02, cyan);
    box(station, 0, 1.55, 0, 0.72, 0.12, 0.72, edge);
    const pillar = new T.Mesh(
      new T.CylinderGeometry(0.025, 0.025, 5, 8),
      new T.MeshBasicMaterial({
        color: 0xeac78a,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
      }),
    );
    pillar.position.y = 3;
    station.add(pillar);
    const ring = new T.Mesh(
      new T.RingGeometry(0.75, 0.8, 48),
      new T.MeshBasicMaterial({
        color: 0xf4c583,
        transparent: true,
        opacity: 0.65,
        side: T.DoubleSide,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.07;
    station.add(ring);
    const pl = new T.PointLight(0x9eafff, 5, 6);
    pl.position.copy(vec(relay, 2));
    this.scene.add(pl);
  }
  resize() {
    const { width, height } = this.host.getBoundingClientRect();
    if (!width || !height) return;
    this.viewportWidth = width;
    this.viewportHeight = height;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(
      renderPixelRatio(width, height, devicePixelRatio, this.renderMode),
    );
    this.renderer.setSize(width, height);
    this.invalidate();
  }
  pick(e: PointerEvent) {
    const rect = this.host.getBoundingClientRect();
    const ray = new T.Raycaster();
    ray.setFromCamera(
      new T.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        (-(e.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      this.camera,
    );
    const p = new T.Vector3();
    if (!ray.ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), 0), p))
      return null;
    const cell: Cell = [Math.round(p.x / S), Math.round(p.z / S)];
    return cell[0] >= SIZE.minX &&
      cell[0] <= SIZE.maxX &&
      cell[1] >= SIZE.minZ &&
      cell[1] <= SIZE.maxZ
      ? cell
      : null;
  }
  clear(group: T.Group) {
    for (const o of [...group.children]) {
      group.remove(o);
      if (o instanceof T.Mesh || o instanceof T.Line) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => m.dispose());
      }
    }
  }
  showRange(u: Unit, show: boolean) {
    this.hoverKey = "";
    this.clear(this.range);
    this.movementPaths.clear();
    if (!show || u.ap <= 0) return;
    const paths = this.game.paths(u);
    this.movementPaths = paths;
    const geometry = new T.PlaneGeometry(S * 0.9, S * 0.9);
    const material = new T.MeshBasicMaterial({
      color: 0xa3c9cb,
      transparent: true,
      opacity: 0.065,
      side: T.DoubleSide,
      depthWrite: false,
    });
    const tiles = new T.InstancedMesh(geometry, material, paths.size);
    const d = new T.Object3D();
    let i = 0;
    for (const path of paths.values()) {
      d.position.copy(vec(path[path.length - 1], 0.055));
      d.rotation.x = -Math.PI / 2;
      d.updateMatrix();
      tiles.setMatrixAt(i++, d.matrix);
    }
    this.range.add(tiles);
  }
  previewPath(p: Cell) {
    return this.movementPaths.get(key(p));
  }
  showGrenadeRange(u: Unit) {
    this.clear(this.range);
    if (u.ap <= 0 || u.grenade) return;
    const points: Cell[] = [];
    for (let x = SIZE.minX; x <= SIZE.maxX; x++)
      for (let z = SIZE.minZ; z <= SIZE.maxZ; z++)
        if (Math.abs(x - u.pos[0]) + Math.abs(z - u.pos[1]) <= 5)
          points.push([x, z]);
    const tiles = new T.InstancedMesh(
      new T.PlaneGeometry(S * 0.93, S * 0.93),
      new T.MeshBasicMaterial({
        color: 0xe7ac66,
        transparent: true,
        opacity: 0.16,
        side: T.DoubleSide,
        depthWrite: false,
      }),
      points.length,
    );
    const dummy = new T.Object3D();
    points.forEach((p, i) => {
      dummy.position.copy(vec(p, 0.08));
      dummy.rotation.x = -Math.PI / 2;
      dummy.updateMatrix();
      tiles.setMatrixAt(i, dummy.matrix);
    });
    this.range.add(tiles);
  }
  showPath(path: Cell[] | undefined, grenade = false) {
    this.clear(this.route);
    if (!path || path.length < 2) return;
    let pts = path.map((p) => vec(p, 0.13));
    if (grenade) {
      const a = pts[0],
        b = pts[pts.length - 1];
      pts = Array.from({ length: 30 }, (_, i) => {
        const t = i / 29;
        return a
          .clone()
          .lerp(b, t)
          .add(new T.Vector3(0, Math.sin(t * Math.PI) * 3, 0));
      });
    }
    const line = new T.Line(
      new T.BufferGeometry().setFromPoints(pts),
      new T.LineDashedMaterial({
        color: grenade ? 0xefad75 : 0xf1d29c,
        dashSize: 0.16,
        gapSize: 0.09,
      }),
    );
    line.computeLineDistances();
    this.route.add(line);
    if (grenade) {
      const ring = new T.Mesh(
        new T.RingGeometry(S * 1.9, S * 2, 64),
        new T.MeshBasicMaterial({
          color: 0xf4a275,
          transparent: true,
          opacity: 0.45,
          side: T.DoubleSide,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.copy(pts[pts.length - 1]);
      this.route.add(ring);
    }
  }
  select(id: string) {
    this.selected = id;
  }
  focus(id = this.selected) {
    if (this.aimKey || this.cameraMotion) return;
    const rig = this.rigs.get(id);
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
  view(cinematic: boolean) {
    this.cinematic = cinematic;
    const u = this.rigs.get(this.selected)!;
    const target = cinematic
      ? u.root.position.clone().add(new T.Vector3(0, 0.7, 0))
      : new T.Vector3(0, 0, -0.3);
    const position = target
      .clone()
      .add(cinematic ? new T.Vector3(6, 3.5, 6) : new T.Vector3(22, 25, 28));
    const start = this.camera.position.clone(),
      startTarget = this.controls.target.clone();
    this.tween(0.85, (t) => {
      this.camera.position.copy(start).lerp(position, t);
      this.controls.target.copy(startTarget).lerp(target, t);
    });
  }
  private coverSequence=new Map<string,number>();
  private async faceCover(rig:Rig,heading:number,token:number,id:string) {
    const start=rig.root.rotation.y,delta=Math.atan2(Math.sin(heading-start),Math.cos(heading-start));
    await this.tween(.16,t=>{if(this.coverSequence.get(id)===token)rig.root.rotation.y=start+delta*t;});
  }
  private async exposeCorner(u: Unit, point: Cell, signature?: string) {
    const rig=this.rigs.get(u.id)!,plan=coverPeek(u.pos,point);
    const token=(this.coverSequence.get(u.id)??0)+1;this.coverSequence.set(u.id,token);
    if(!plan.high||plan.blocked)return;
    this.host.dataset.coverPhase="stepping-out";
    const end=new T.Vector3(plan.position[0],surfaceHeight(...plan.position),plan.position[1]);
    const start=rig.root.position.clone();
    if(start.distanceTo(end)<.025){this.host.dataset.coverPhase="exposed";return;}
    const step=coverStep(u.pos,[start.x,start.z],[end.x,end.z]);
    this.host.dataset.coverSide=step.side;
    await this.faceCover(rig,step.heading,token,u.id);
    if(this.coverSequence.get(u.id)!==token||(signature&&this.aimKey!==signature))return;
    const motion=step.motion,duration=.72;
    play(rig,motion,true,rig.clips.get(motion)!.duration/duration,.12);
    await this.tween(duration,t=>{if(this.coverSequence.get(u.id)!==token||(signature&&this.aimKey!==signature))return;rig.root.position.copy(start).lerp(end,t);rig.root.position.y=surfaceHeight(rig.root.position.x,rig.root.position.z);});
    if(this.coverSequence.get(u.id)===token)this.host.dataset.coverPhase="exposed";
  }
  private async withdrawCorner(u: Unit) {
    const rig=this.rigs.get(u.id)!,start=rig.root.position.clone(),end=vec(u.pos);
    const token=(this.coverSequence.get(u.id)??0)+1;this.coverSequence.set(u.id,token);
    if(start.distanceTo(end)<.025)return;
    this.host.dataset.coverPhase="withdrawing";
    const step=coverStep(u.pos,[start.x,start.z],[end.x,end.z]);
    this.host.dataset.coverSide=step.side;
    await this.faceCover(rig,step.heading,token,u.id);
    if(this.coverSequence.get(u.id)!==token)return;
    const duration=.72;play(rig,step.motion,true,rig.clips.get(step.motion)!.duration/duration,.12);
    await this.tween(duration,t=>{if(this.coverSequence.get(u.id)!==token)return;rig.root.position.copy(start).lerp(end,t);rig.root.position.y=surfaceHeight(rig.root.position.x,rig.root.position.z);});
    if(this.coverSequence.get(u.id)===token)this.host.dataset.coverPhase="sheltered";
  }
  aimAt(u: Unit, point: Cell, kind: "fire" | "grenade"): Promise<void> {
    const signature = `${u.id}:${u.pos}:${point}:${u.weapon}:${kind}`;
    if (signature === this.aimKey) return this.aimReady;
    const switchingTarget=this.aimUnit===u.id && !!this.aimKey;
    if (!this.savedCamera)
      this.savedCamera = {
        position: this.camera.position.clone(),
        target: this.controls.target.clone(),
        fov: this.camera.fov,
      };
    this.aimKey = signature;
    ++this.cameraSequence;
    this.cameraMotion=true;
    this.host.dataset.cameraReady="false";
    this.host.closest(".battlefield")?.classList.add("camera-moving");
    this.aimUnit = u.id;
    this.controls.enabled = false;
    const rig = this.rigs.get(u.id)!;
    const look = vec(point, kind === "fire" ? 1.08 : .8);
    rig.aimTarget = look.clone();
    this.aimPoint = null;
    this.host.dataset.cameraMode = "shoulder";
    this.aimReady = (async () => {
      const wall = kind === "fire" && physicalCover(u.pos)==="high";
      const covered = this.game.cover(u) > 0 && !wall;
      if (wall) await this.exposeCorner(u, point, signature);
      if (this.aimKey !== signature) return;
      const forward = look.clone().sub(rig.root.position).setY(0).normalize();
      if (!forward.lengthSq()) forward.set(0,0,-1);
      const heading=Math.atan2(-forward.x,-forward.z);
      const wasAiming=!!rig.action?.getClip().name.endsWith("_fire") && !!rig.action.paused;
      if (kind === "fire") {
        if (covered && u.weapon !== "pistol" && !rig.action?.getClip().name.endsWith("_fire")) {
          const duration = play(rig,"covered_rise",true);
          await this.tween(duration,()=>{});
        }
        if (this.aimKey !== signature) return;
        if (wall && coverPeek(u.pos,point).blocked) holdHuman(rig,"stand_cover_idle",0);
        else aimHuman(rig,covered);
      } else play(rig,"crouch_idle");
      // Let the held pose finish blending before measuring its actual shoulder.
      if(!wasAiming)await this.tween(.25,()=>{});
      if (this.aimKey !== signature) return;
      const head=rig.model.getObjectByName("mixamorigHead")!.getWorldPosition(new T.Vector3());
      const right=new T.Vector3().crossVectors(forward,new T.Vector3(0,1,0));
      const cameraPosition=head.clone().addScaledVector(forward,kind==="fire"?-2.5:-4.2)
        .addScaledVector(right,kind==="fire"?.62:1.5);
      cameraPosition.y += kind==="fire"?-.12:1.5;
      // Eye-level framing, with room for both shooter and target on narrow displays.
      const fov=kind==="grenade"?48:this.camera.aspect<1.2?56:48;
      const turnStart=rig.root.rotation.y,turnDelta=shortestAngle(turnStart,heading);
      const pivot=rig.root.position.clone();
      await Promise.all([
        this.tween(.65,t=>{if(this.aimKey===signature)rig.root.rotation.y=turnStart+turnDelta*t;}),
        this.cameraTo(cameraPosition,look,fov,.65,switchingTarget?pivot:undefined),
      ]);
      if(this.aimKey===signature)this.aimPoint=look;
    })();
    return this.aimReady;
  }
  leaveAim(): Promise<void> {
    if (!this.savedCamera) return this.aimReady;
    const saved = this.savedCamera;
    this.savedCamera = null;
    this.aimKey = "";
    const aimingRig = this.rigs.get(this.aimUnit);
    let returnPose = Promise.resolve();
    if (aimingRig && !aimingRig.dead) {
      aimingRig.aimTarget = null;
      const unit = this.game.units.find((u) => u.id === this.aimUnit)!;
      if(physicalCover(unit.pos)==="high") {
        returnPose=this.withdrawCorner(unit).then(()=>{if(!this.aimKey)this.rest(unit);});
      } else if (
        this.game.cover(unit) > 0 &&
        unit.weapon !== "pistol" &&
        aimingRig.action?.getClip().name.endsWith("_fire")
      ) {
        const duration = play(aimingRig, "covered_return", true);
        returnPose = this.tween(duration, () => {}).then(() => {
          if (!this.aimKey) this.rest(unit);
        });
      } else this.rest(unit);
    }
    this.aimUnit = "";
    this.aimPoint = null;
    this.host.dataset.cameraMode = "returning";
    this.aimReady = Promise.all([
      this.cameraTo(saved.position, saved.target, saved.fov, 0.65),
      returnPose,
    ]).then(() => {});
    return this.aimReady;
  }
  private cameraTo(
    position: T.Vector3,
    target: T.Vector3,
    fov: number,
    duration: number,
    orbit?: T.Vector3,
  ) {
    const sequence = ++this.cameraSequence;
    this.cameraMotion = true;
    this.host.dataset.cameraReady = "false";
    this.host.closest(".battlefield")?.classList.add("camera-moving");
    const start = this.camera.position.clone(),
      look = this.controls.target.clone(),
      startFov = this.camera.fov;
    return this.tween(duration, (t) => {
      if (sequence !== this.cameraSequence) return;
      if(orbit)shoulderArc(start,position,orbit,t,this.camera.position);
      else this.camera.position.copy(start).lerp(position, t);
      this.controls.target.copy(look).lerp(target, t);
      this.camera.fov = startFov + (fov - startFov) * t;
      this.camera.updateProjectionMatrix();
      this.camera.lookAt(this.controls.target);
    }).then(() => {
      if (sequence !== this.cameraSequence) return;
      this.cameraMotion = false;
      this.host.dataset.cameraReady = "true";
      this.host.closest(".battlefield")?.classList.remove("camera-moving");
      this.controls.enabled = !this.aimKey;
      if (!this.aimKey) {
        this.host.dataset.cameraMode = this.cinematic ? "close" : "tactical";
        this.controls.enableDamping = false;
        this.controls.update();
        this.controls.enableDamping = true;
      }
    });
  }
  tween(seconds: number, fn: (t: number) => void, smooth = true) {
    this.invalidate();
    return new Promise<void>((resolve) => {
      let elapsed = 0;
      this.jobs.push((dt) => {
        elapsed += dt;
        const t = Math.min(1, elapsed / seconds);
        fn(smooth ? t * t * (3 - 2 * t) : t);
        if (t >= 1) {
          resolve();
          return true;
        }
        return false;
      });
    });
  }
  private rest(u: Unit) {
    const rig=this.rigs.get(u.id)!,stance=coverStance(u.pos);
    if(stance.heading!==null && !u.overwatch)rig.root.rotation.y=stance.heading;
    restHuman(rig, u, stance.kind!=="none");
  }
  private async clip(r: Rig, name: Motion, speed = 1) {
    this.host.dataset.motion = name;
    const duration = play(r, name, true, speed);
    await this.tween(duration, () => {});
  }
  async move(u: Unit, path: Cell[]) {
    const r = this.rigs.get(u.id)!;
    r.busy = true;
    const originCovered = physicalCover(path[0]) === "low";
    if (originCovered) await this.clip(r, "crouch_exit", 1.6);
    for (let i = 1; i < path.length; i++) {
      const start = r.root.position.clone();
      let end = vec(path[i]);
      const vault = covers.some((c) => key(c) === key(path[i]));
      const coveredStep = !vault && wallTravel(path[i-1],path[i]);
      let seconds = coveredStep ? .72 : .24;
      if (vault && i + 1 < path.length) {
        end = vec(path[++i]);
        seconds = play(r, "vault", true, 1, 0.1);
      } else if (coveredStep) {
        const step=coverStep(path[i-1],[start.x,start.z],[end.x,end.z]);
        r.root.rotation.y=step.heading;
        play(r,step.motion,true,r.clips.get(step.motion)!.duration/seconds,.12);
      } else play(r, "rifle_run", false, 1);
      const heading = Math.atan2(start.x - end.x, start.z - end.z);
      // Side-stepping keeps the torso facing the cover; running faces travel.
      if (!coveredStep) r.root.rotation.y = heading;
      await this.tween(
        seconds,
        (t) => {
          r.root.position.copy(start).lerp(end, vault ? vaultProgress(t) : t);
        },
        false,
      );
    }
    const stance=coverStance(u.pos);
    if(stance.heading!==null){
      const start=r.root.rotation.y,turn=shortestAngle(start,stance.heading);
      await this.tween(.2,t=>{r.root.rotation.y=start+turn*t;});
    }
    if (stance.kind==="low") await this.clip(r, "crouch_enter", 1.8);
    r.busy = false;
    this.rest(u);
  }
  setWeapon(u: Unit) {
    const r = this.rigs.get(u.id)!;
    if (!r.busy && this.aimKey !== "drill") equipHuman(r, u.weapon);
  }
  async changeWeapon(u: Unit, weapon: Weapon) {
    const r = this.rigs.get(u.id)!;
    if (r.weapon === weapon) return;
    r.busy = true;
    await this.clip(r, "put_back_rifle", 2.4);
    if (this.game.switchWeapon(u, weapon)) equipHuman(r, weapon);
    await this.clip(r, "draw_rifle", 1.7);
    r.busy = false;
    this.rest(u);
  }
  async reaction(u: Unit, heavy = false) {
    const r = this.rigs.get(u.id)!;
    if (r.dead) return;
    r.busy = true;
    if (u.hp <= 0) {
      r.dead = true;
      this.labels.get(u.id)!.hidden = true;
    }
    await this.clip(
      r,
      reactionMotion(r.dead, this.game.cover(u) > 0, heavy),
      1.35,
    );
    r.busy = false;
    if (!r.dead) this.rest(u);
  }
  async fire(a: Unit, b: Unit, hit = false) {
    const r = this.rigs.get(a.id)!;
    r.busy = true;
    const target = vec(b.pos, 1);
    r.aimTarget = target.clone();
    const from = r.root.position;
    r.root.rotation.y = Math.atan2(from.x - target.x, from.z - target.z);
    const wall=physicalCover(a.pos)==="high";
    const covered = this.game.cover(a) > 0 && !wall;
    if (this.aimUnit !== a.id) {
      if(wall)await this.exposeCorner(a,b.pos);
      r.root.rotation.y=Math.atan2(r.root.position.x-target.x,r.root.position.z-target.z);
      if (covered && a.weapon !== "pistol") {
        const duration = play(r, "covered_rise", true);
        await this.tween(duration, () => {});
      }
      aimHuman(r, covered);
      await this.tween(0.28, () => {});
    }
    const shotMotion = aimClip(a.weapon, covered);
    const shotDuration = play(r, shotMotion, true, 1, 0.08);
    this.host.dataset.motion = shotMotion;
    const reaction = hit
      ? this.reaction(b, a.weapon === "sniper")
      : Promise.resolve();
    const shots = a.weapon === "rifle" ? 3 : 1;
    for (let i = 0; i < shots; i++) {
      const origin = r.gun.getWorldPosition(new T.Vector3());
      origin.add(target.clone().sub(origin).normalize().multiplyScalar(0.35));
      const tracer = new T.Line(
        new T.BufferGeometry().setFromPoints([origin, target]),
        new T.LineBasicMaterial({
          color: a.enemy ? 0xff8068 : 0xffdd9a,
          transparent: true,
          opacity: 1,
        }),
      );
      this.fx.add(tracer);
      const flash = this.effectLight;
      flash.color.set(0xffc56f);
      flash.intensity = 12;
      flash.distance = 4;
      flash.position.copy(origin);

      const cameraOrigin = this.camera.position.clone();
      await this.tween(0.1, (t) => {
        if (this.aimUnit === a.id) {
          this.camera.position.copy(cameraOrigin);
          this.camera.position.y +=
            Math.sin(t * Math.PI) * (a.weapon === "sniper" ? 0.11 : 0.035);
          this.camera.lookAt(this.controls.target);
        }

        (tracer.material as T.LineBasicMaterial).opacity = 1 - t;
      });
      if (this.aimUnit === a.id) this.camera.position.copy(cameraOrigin);
      this.fx.remove(tracer);
      flash.intensity = 0;
      tracer.geometry.dispose();
      (tracer.material as T.Material).dispose();
      await this.tween(0.1, () => {});
    }
    await this.tween(Math.max(0.15, shotDuration - shots * 0.2), () => {});
    await reaction;
    r.aimTarget = null;
    if (covered && a.weapon !== "pistol") {
      const duration = play(r, "covered_return", true);
      await this.tween(duration, () => {});
    }
    if(wall)await this.withdrawCorner(a);
    this.rest(a);
    await this.tween(0.3, () => {});
    r.busy = false;
  }
  async reload(u: Unit) {
    const r = this.rigs.get(u.id)!;
    r.busy = true;
    await this.clip(r, reloadMotion(u.weapon, this.game.cover(u) > 0), 1.35);
    r.busy = false;
    this.rest(u);
  }
  async grenade(u: Unit, p: Cell) {
    const r = this.rigs.get(u.id)!;
    r.busy = true;
    const target = vec(p, 0.2);
    r.root.rotation.y = Math.atan2(
      r.root.position.x - target.x,
      r.root.position.z - target.z,
    );
    const duration = play(r, "toss_grenade", true, 1.25);
    r.gun.visible = true;
    await this.tween(duration * 0.43, () => {});
    const ball = new T.Mesh(new T.SphereGeometry(0.075, 12, 10), metal);
    this.fx.add(ball);
    const start = r.hand.getWorldPosition(new T.Vector3());
    await this.tween(0.75, (t) => {
      ball.position.copy(start).lerp(target, t);
      ball.position.y += Math.sin(Math.PI * t) * 2.5;
    });
    this.fx.remove(ball);
    ball.geometry.dispose();
    await this.explosion(target);
    await Promise.all(
      this.game.units
        .filter(
          (v) =>
            v.id !== u.id &&
            Math.abs(v.pos[0] - p[0]) + Math.abs(v.pos[1] - p[1]) <= 2 &&
            !this.rigs.get(v.id)!.dead,
        )
        .map((v) => this.reaction(v, true)),
    );
    r.gun.visible = true;
    r.busy = false;
    this.rest(u);
  }
  async explosion(p: T.Vector3) {
    const flash = this.effectLight;
    flash.color.set(0xffa24e);
    flash.intensity = 40;
    flash.distance = 12;
    flash.position.copy(p).add(new T.Vector3(0, 1, 0));

    const cloud = new T.Mesh(
      new T.SphereGeometry(1, 16, 12),
      new T.MeshBasicMaterial({
        color: 0xffaa65,
        transparent: true,
        opacity: 0.8,
        wireframe: true,
      }),
    );
    cloud.position.copy(p);
    this.fx.add(cloud);
    const particles: Array<{ mesh: T.Mesh; velocity: T.Vector3 }> = [];
    for (let i = 0; i < 24; i++) {
      const mesh = new T.Mesh(new T.BoxGeometry(0.07, 0.07, 0.07), amber);
      mesh.position.copy(p);
      this.fx.add(mesh);
      particles.push({
        mesh,
        velocity: new T.Vector3(
          (random() - 0.5) * 6,
          random() * 4,
          (random() - 0.5) * 6,
        ),
      });
    }
    await this.tween(0.75, (t) => {
      cloud.scale.setScalar(0.2 + t * 2.7);
      (cloud.material as T.MeshBasicMaterial).opacity = 0.8 * (1 - t);
      flash.intensity = 40 * (1 - t);
      for (const part of particles) {
        part.mesh.position.copy(p).addScaledVector(part.velocity, t);
        part.mesh.position.y += 1 - 2 * t * t;
      }
    });
    this.fx.remove(cloud);
    flash.intensity = 0;
    cloud.geometry.dispose();
    (cloud.material as T.Material).dispose();
    for (const part of particles) {
      this.fx.remove(part.mesh);
      part.mesh.geometry.dispose();
    }
  }
  async stance(u: Unit) {
    const r = this.rigs.get(u.id)!;
    r.busy = true;
    await this.clip(r, "crouch_enter", 1.8);
    await this.clip(r, "hunker_down");
    r.busy = false;
    this.rest(u);
  }
  async watch(u: Unit) {
    const r = this.rigs.get(u.id)!;
    r.busy = true;
    if (this.game.cover(u)) await this.clip(r, "crouch_exit", 1.8);
    await this.clip(r, "overwatch_ready");
    r.busy = false;
    this.rest(u);
  }
  private drillCamera: {
    position: T.Vector3;
    target: T.Vector3;
    fov: number;
  } | null = null;
  private drillOperator: { unit: Unit; rotation: number } | null = null;
  async endDrills() {
    if (!this.drillCamera) return;
    const old = this.drillCamera;
    this.drillCamera = null;
    if (this.drillOperator) {
      const { unit, rotation } = this.drillOperator;
      const r = this.rigs.get(unit.id)!;
      r.root.rotation.y = rotation;
      equipHuman(r, unit.weapon);
      this.rest(unit);
      this.drillOperator = null;
    }
    this.aimKey = "";
    await this.cameraTo(old.position, old.target, old.fov, 0.5);
  }
  async drill(u: Unit, motion: Motion) {
    const r = this.rigs.get(u.id)!;
    const old = {
      position: this.camera.position.clone(),
      target: this.controls.target.clone(),
      fov: this.camera.fov,
      rotation: r.root.rotation.y,
      weapon: r.weapon,
    };
    if (!this.drillCamera) {
      this.drillCamera = {
        position: old.position,
        target: old.target,
        fov: old.fov,
      };
      this.drillOperator = { unit: u, rotation: old.rotation };
    }
    r.busy = true;
    this.controls.enabled = false;
    this.aimKey = "drill";
    this.host.dataset.drill = motion;
    const weapon: Weapon = motion.startsWith("pistol")
      ? "pistol"
      : motion === "sniper_shot"
        ? "sniper"
        : "rifle";
    equipHuman(r, weapon);
    r.root.rotation.y = 0;
    const center = r.root.position.clone();
    const weaponStudy = /shooting|rifle_burst|sniper_shot|pistol_(ready|shot|reload)|reload|rifle_idle|overwatch_ready/.test(motion);
    try {
      await this.cameraTo(
        center.clone().add(weaponStudy ? new T.Vector3(1.6, 1.7, -2.8) : new T.Vector3(2.7, 1.8, -4.3)),
        center.clone().add(new T.Vector3(0, weaponStudy ? 1.35 : 1, 0)),
        35,
        0.5,
      );
      r.gun.visible = true;
      await this.clip(r, motion);
      holdHuman(r, motion);
      await this.tween(0.3, () => {});
    } finally {
      r.gun.visible = true;
      this.controls.enabled = true;
      r.busy = false;
      this.host.dataset.drill = "";
    }
  }
  sync() {
    for (const u of this.game.units) {
      const r = this.rigs.get(u.id)!;
      const label = this.labels.get(u.id)!;
      label.classList.toggle("selected", u.id === this.selected);
      label
        .querySelector("i")!
        .style.setProperty("--health", `${(u.hp / u.maxHp) * 100}%`);
      if (u.hp <= 0 && !r.dead && !r.busy) {
        void this.reaction(u);
      } else if (u.hp > 0) {
        this.labels.get(u.id)!.hidden = false;
        this.setWeapon(u);
        if (!r.busy && !this.aimKey) this.rest(u);
      }
    }
  }
  private updateOcclusion() {
    const focus = this.controls.target;
    const points: T.Vector3[] = [focus];
    // Dense foreground blocks must not hide an unselected operator or an enemy.
    let sample=0;
    for(const u of this.game.units) {
      if(u.hp<=0)continue;
      const rig=this.rigs.get(u.id);if(!rig)continue;
      const point=this.occlusionSamples[sample] ??= new T.Vector3();
      point.copy(rig.root.position);point.y+=1.05;points.push(point);sample++;
    }
    if (this.aimPoint) points.push(this.aimPoint);
    let hidden = 0;
    for (const { group, bounds } of this.occluders) {
      let blocked = false;
      for (const point of points) {
        if (!point) continue;
        this.occlusionDirection.copy(point).sub(this.camera.position);
        const distance = this.occlusionDirection.length();
        this.occlusionRay.set(
          this.camera.position,
          this.occlusionDirection.normalize(),
        );
        const hit = this.occlusionRay.intersectBox(bounds, this.occlusionHit);
        if (hit && hit.distanceTo(this.camera.position) < distance - 0.7) {
          blocked = true;
          break;
        }
      }
      group.visible = !blocked;
      if (blocked) hidden++;
    }
    this.host.dataset.occludedBuildings = String(hidden);
  }
  /** Freeze animation jobs, rigs and rain; the last frame stays on screen. */
  setPaused(paused: boolean) {
    this.paused = paused;
    this.host.dataset.paused = String(paused);
    this.pacer.reset();
    this.invalidate();
  }
  invalidate() {
    this.activeUntil = performance.now() + 1200;
    if (!this.disposed && !document.hidden && !this.raf) {
      this.pacer.reset();
      this.raf = requestAnimationFrame(this.animate);
    }
  }
  setTimeOfDay(time: TimeOfDay) {
    this.timeOfDay = time;
    const p = applyTimeOfDay(this.scene, this.sun, this.ambient, this.rim, time);
    this.renderer.toneMappingExposure = p.exposure;
    this.mist.mesh.material.uniforms.tint.value.setHex(p.mist);
    this.renderer.shadowMap.needsUpdate = true;
    this.host.dataset.timeOfDay = time;
    this.invalidate();
  }
  setRain(enabled: boolean) {
    this.rain.visible = enabled;
    this.host.dataset.rain = String(enabled);
    this.invalidate();
  }
  setRenderMode(mode: RenderMode) {
    this.renderMode = mode;
    this.resize();
  }
  animate = (now: number) => {
    this.raf = 0;
    if (this.disposed) return;
    const active =
      now < this.activeUntil ||
      this.jobs.length > 0 ||
      [...this.rigs.values()].some((r) => r.busy);
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
    const dt = elapsed,
      time = now / 1000;
    this.mist.update(time);
    // Hidden tabs suspend the timeline; returning resumes the current action without a jump.
    this.jobs = this.jobs.filter((job) => !job(elapsed));
    if (!this.aimKey && !this.cameraMotion) this.controls.update();
    if (!this.paused && this.rain.visible) {
      for (let i = 0; i < this.rainArray.length; i += 6) {
        this.rainArray[i + 1] -= dt * 15;
        this.rainArray[i + 4] -= dt * 15;
        this.rainArray[i] -= dt * 2;
        this.rainArray[i + 3] -= dt * 2;
        if (this.rainArray[i + 1] < 0) {
          this.rainArray[i + 1] += 23;
          this.rainArray[i + 4] += 23;
        }
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
    }
    const width = this.viewportWidth,
      height = this.viewportHeight;
    for (const u of this.game.units) {
      const r = this.rigs.get(u.id)!;
      if (!r.dead || r.action?.isRunning()) updateHuman(r, dt, surfaceHeight);
      const contact = this.contactShadows.get(u.id)!;
      contact.position.copy(r.root.position);
      contact.position.y = surfaceHeight(contact.position.x, contact.position.z) + 0.035;
      contact.visible = u.hp > 0;
      if (u.hp <= 0) continue;
      const p = this.labelPoint
        .copy(r.root.position)
        .add(this.labelOffset)
        .project(this.camera);
      const l = this.labels.get(u.id)!;
      l.style.display =
        p.z > 1 || p.x < -1 || p.x > 1 || p.y < -1 || p.y > 1 ? "none" : "";
      const labelTransform = `translate(${(p.x * 0.5 + 0.5) * width}px,${(-p.y * 0.5 + 0.5) * height}px) translate(-50%,-100%)`;
      if (l.style.transform !== labelTransform)
        l.style.transform = labelTransform;
    }
    const selectedRig = this.rigs.get(this.selected);
    if (selectedRig) {
      this.selector.position.copy(selectedRig.root.position);
      this.selector.position.y = surfaceHeight(this.selector.position.x, this.selector.position.z) + 0.04;
      this.selector.rotation.z = time * 0.3;
      this.selector.visible =
        this.game.units.find((u) => u.id === this.selected)!.hp > 0;
    }
    const reticle = document.querySelector<HTMLElement>("#aim-reticle");
    if (reticle) {
      reticle.hidden = !this.aimPoint || this.cameraMotion;
      if (this.aimPoint) {
        const p = this.aimPoint.clone().project(this.camera);
        reticle.style.left = `${(p.x * 0.5 + 0.5) * width}px`;
        reticle.style.top = `${(-p.y * 0.5 + 0.5) * height}px`;
      }
    }
    this.updateOcclusion();
    this.renderer.info.autoReset = false;
    this.renderer.info.reset();
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    let measuring = false;
    if (this.gpuExtension) {
      if (
        this.gpuQuery &&
        gl.getQueryParameter(this.gpuQuery, gl.QUERY_RESULT_AVAILABLE)
      ) {
        if (!gl.getParameter(this.gpuExtension.GPU_DISJOINT_EXT)) {
          this.gpuSamples.push(
            gl.getQueryParameter(this.gpuQuery, gl.QUERY_RESULT) / 1e6,
          );
          if (this.gpuSamples.length > 180) this.gpuSamples.shift();
        }
        gl.deleteQuery(this.gpuQuery);
        this.gpuQuery = null;
      }
      if (!this.gpuQuery) {
        this.gpuQuery = gl.createQuery();
        gl.beginQuery(this.gpuExtension.TIME_ELAPSED_EXT, this.gpuQuery);
        measuring = true;
      }
    }
    const renderStart = performance.now();
    this.renderer.render(this.scene, this.camera);
    if (measuring) gl.endQuery(this.gpuExtension!.TIME_ELAPSED_EXT);
    if (this.profileEnabled) {
      this.profileSamples.push([
        elapsed * 1000,
        renderStart - cpuStart,
        performance.now() - renderStart,
      ]);
      if (this.profileSamples.length > 180) this.profileSamples.shift();
      if (now - this.profileLast > 500) {
        this.profileLast = now;
        const average = (i: number) =>
          this.profileSamples.reduce((a, v) => a + v[i], 0) /
          this.profileSamples.length;
        const p95 = (i: number) =>
          this.profileSamples.map((v) => v[i]).sort((a, b) => a - b)[
            Math.floor((this.profileSamples.length - 1) * 0.95)
          ];
        this.host.dataset.profile = JSON.stringify({
          gpuMs: this.gpuSamples.length
            ? +(
                this.gpuSamples.reduce((a, v) => a + v, 0) /
                this.gpuSamples.length
              ).toFixed(2)
            : null,
          samples: this.profileSamples.length,
          fps: +(1000 / average(0)).toFixed(1),
          frameP95: +p95(0).toFixed(1),
          updateMs: +average(1).toFixed(2),
          renderSubmitMs: +average(2).toFixed(2),
          cpuP95: +(p95(1) + p95(2)).toFixed(2),
        });
      }
    }
    this.host.dataset.renderFrames = String(++this.frameCount);
    if (now - this.lastMetrics > 250) {
      this.lastMetrics = now;
      this.host.dataset.renderMode = this.renderMode;
      this.host.dataset.renderCalls = String(this.renderer.info.render.calls);
      this.host.dataset.renderTriangles = String(
        this.renderer.info.render.triangles,
      );
      this.host.dataset.renderTextures = String(
        this.renderer.info.memory.textures,
      );
    }
  };
  async warmup() {
    const hidden: T.Object3D[] = [];
    for (const r of this.rigs.values())
      for (const o of [r.rifle, r.pistol, r.scope]) {
        if (!o.visible) {
          hidden.push(o);
          o.visible = true;
        }
      }
    try {
      await this.renderer.compileAsync(this.scene, this.camera);
    } finally {
      for (const o of hidden) o.visible = false;
    }
  }
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
    document.removeEventListener("visibilitychange", this.onVisibility);
    const geometries = new Set<T.BufferGeometry>(),
      materials = new Set<T.Material>(),
      textures = new Set<T.Texture>(),
      skeletons = new Set<T.Skeleton>();
    this.scene.traverse((o) => {
      if (o instanceof T.Mesh || o instanceof T.Line) {
        geometries.add(o.geometry);
        for (const m of Array.isArray(o.material) ? o.material : [o.material])
          materials.add(m);
        if (o instanceof T.SkinnedMesh) skeletons.add(o.skeleton);
      }
    });
    for (const m of materials) {
      for (const value of Object.values(m))
        if (value instanceof T.Texture) textures.add(value);
      m.dispose();
    }
    for (const t of textures) t.dispose();
    for (const g of geometries) g.dispose();
    for (const skeleton of skeletons) skeleton.dispose();
    if (this.gpuQuery)
      (this.renderer.getContext() as WebGL2RenderingContext).deleteQuery(
        this.gpuQuery,
      );
    this.mist.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

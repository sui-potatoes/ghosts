// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT
import * as T from "three";

export const MOUTH_OFFSET = [0, 0.023, 0.095] as const;
export const SMOKING_SOURCE_START = 8.2;
export const SMOKING_SOURCE_END = 11.6;
export const SMOKING_DURATION = 5;
/** Palm frame correction from the immutable knuckle offsets, in either rig's units. */
export function smokingHandRoll(hand: T.Object3D) {
  const p = (finger: string) =>
    hand.getObjectByName(`${hand.name}${finger}1`)!.position.clone();
  const normal = p("Index").sub(p("Pinky")).cross(p("Middle")).normalize();
  return 0.005634666 - Math.atan2(normal.x, normal.z);
}
export const SMOKING_HAND_AXES = [
  [-0.902293, -0.187888, 0.388028],
  [-0.830301, 0.345946, -0.436946],
] as const;
const smooth = (a: number, b: number, t: number) =>
  T.MathUtils.smoothstep(t, a, b);
/** One captured drag/exhale plus a return blend; the cigarette is already lit. */
export function smokingPhase(time: number) {
  const t = ((time % SMOKING_DURATION) + SMOKING_DURATION) % SMOKING_DURATION;
  return {
    visible: true,
    lit: 1,
    mouth: Math.max(
      1 - smooth(0, 0.25, t),
      smooth(SMOKING_DURATION - 0.2, SMOKING_DURATION, t),
    ),
    retrieved: true,
    inhale: Math.max(
      1 - smooth(0.1, 0.4, t),
      smooth(SMOKING_DURATION - 0.4, SMOKING_DURATION - 0.1, t),
    ),
    exhale: smooth(0.6, 0.9, t) * (1 - smooth(2.2, 2.9, t)),
  };
}

/** Scene-owned, bounded particles. No textures, timers or independent render loop. */
export class SmokingEffect {
  readonly group = new T.Group();
  readonly cigarette = new T.Group();
  readonly light = new T.PointLight(0xff5821, 0, 0.22, 2);
  private ember = new T.MeshStandardMaterial({
    color: 0x442018,
    emissive: 0xff3b08,
    emissiveIntensity: 2,
  });
  private geometry = new T.PlaneGeometry(1, 1);
  private opacity = new T.InstancedBufferAttribute(new Float32Array(96), 1);
  private material = new T.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    vertexShader: `attribute float opacity; varying float alpha; varying vec2 tex;
            void main() { alpha=opacity; tex=uv; vec4 center=modelViewMatrix*instanceMatrix*vec4(0.,0.,0.,1.);
            float size=length(instanceMatrix[0].xyz); center.xy+=position.xy*size; gl_Position=projectionMatrix*center; }`,
    fragmentShader: `varying float alpha; varying vec2 tex;
            void main() { float r=length(tex-.5)*2.; float a=exp(-r*r*5.)*(1.-smoothstep(.65,1.,r))*alpha;
            gl_FragColor=vec4(.65,.69,.72,a); }`,
  });
  private smoke = new T.InstancedMesh(this.geometry, this.material, 96);
  private particles: {
    p: T.Vector3;
    v: T.Vector3;
    age: number;
    life: number;
    size: number;
    exhale: boolean;
  }[] = [];
  private hand: T.Object3D;
  private index: T.Object3D;
  private middle: T.Object3D;
  private head: T.Object3D;
  private transform = new T.Object3D();
  private tip = new T.Vector3();
  private mouth = new T.Vector3();
  private direction = new T.Vector3();
  private rotation = new T.Quaternion();
  private mouthRotation = new T.Quaternion();
  private sockets: T.Quaternion[];
  private clock = 0;
  private trail = 0;
  private breath = 0;
  private boneUnits: number;
  private active = false;
  private root: T.Object3D;
  constructor(root: T.Object3D) {
    this.root = root;
    const find = (suffix: string) => {
      let found: T.Object3D | undefined;
      root.traverse((b) => {
        if (b.name.replaceAll(":", "").endsWith(suffix)) found = b;
      });
      if (!found) throw Error(`Smoking bone missing: ${suffix}`);
      return found;
    };
    this.hand = find("RightHand");
    const roll = smokingHandRoll(this.hand);
    this.sockets = SMOKING_HAND_AXES.map((axis) =>
      new T.Quaternion().setFromUnitVectors(
        new T.Vector3(0, 0, 1),
        new T.Vector3(...axis)
          .normalize()
          .applyAxisAngle(new T.Vector3(0, 1, 0), -roll),
      ),
    );
    this.index = find("RightHandIndex2");
    this.middle = find("RightHandMiddle2");
    this.head = find("Head");
    // Combat bones are centimetres; studio bones are metres.
    this.boneUnits = this.index.position.length() > 1 ? 100 : 1;
    const paper = new T.MeshStandardMaterial({
      color: 0xe0d7bc,
      roughness: 0.95,
    });
    const filter = new T.MeshStandardMaterial({
      color: 0xb78043,
      roughness: 1,
    });
    const ash = new T.MeshStandardMaterial({ color: 0x77746b, roughness: 1 });
    for (const [length, z, radius, material] of [
      [0.052, 0.022, 0.0034, paper],
      [0.022, -0.015, 0.0035, filter],
      [0.004, 0.05, 0.0036, this.ember],
      [0.003, 0.053, 0.0035, ash],
    ] as const) {
      const mesh = new T.Mesh(
        new T.CylinderGeometry(radius, radius, length, 8),
        material,
      );
      mesh.rotation.x = Math.PI / 2;
      mesh.position.z = z;
      this.cigarette.add(mesh);
    }
    this.light.position.z = 0.052;
    this.cigarette.add(this.light);
    this.geometry.setAttribute("opacity", this.opacity);
    this.smoke.instanceMatrix.setUsage(T.DynamicDrawUsage);
    this.smoke.frustumCulled = false;
    this.smoke.count = 0;
    this.group.name = "SmokingEffect";
    this.group.add(this.cigarette, this.smoke);
    root.add(this.group);
    this.group.visible = false;
  }
  update(enabled: boolean, time: number, dt: number) {
    if (!enabled) {
      this.clear();
      return;
    }
    this.active = true;
    this.group.visible = true;
    const phase = smokingPhase(time);
    // Frame every socket in the unit root's space so body transforms and turns are respected.
    this.root.updateWorldMatrix(true, true);
    this.cigarette.position
      .copy(this.index.getWorldPosition(this.tip))
      .lerp(this.middle.getWorldPosition(this.mouth), 0.5);
    this.root.worldToLocal(this.cigarette.position);
    this.rotation
      .copy(this.root.getWorldQuaternion(new T.Quaternion()))
      .invert();
    this.cigarette.quaternion
      .copy(this.rotation)
      .multiply(this.hand.getWorldQuaternion(new T.Quaternion()));
    this.cigarette.quaternion.multiply(this.sockets[phase.retrieved ? 1 : 0]);
    this.mouth.set(...MOUTH_OFFSET).multiplyScalar(this.boneUnits);
    this.head.localToWorld(this.mouth);
    this.root.worldToLocal(this.mouth);
    this.mouthRotation
      .copy(this.rotation)
      .multiply(this.head.getWorldQuaternion(new T.Quaternion()));
    this.direction.set(0, 0, 1).applyQuaternion(this.mouthRotation);
    // The capture puts the cigarette between the lips while the hands light it,
    // then retrieves it. Blend sockets during those two physical transfers.
    this.tip.copy(this.mouth).addScaledVector(this.direction, 0.026);
    this.cigarette.position.lerp(this.tip, phase.mouth);
    this.cigarette.quaternion.slerp(this.mouthRotation, phase.mouth);
    this.cigarette.visible = phase.visible;
    this.tip
      .set(0, 0, 0.052)
      .applyQuaternion(this.cigarette.quaternion)
      .add(this.cigarette.position);
    this.light.intensity = phase.lit * (0.0006 + 0.003 * phase.inhale);
    this.ember.emissiveIntensity = phase.lit * (1.5 + 4 * phase.inhale);
    const delta = T.MathUtils.clamp(dt, 0, 0.1);
    this.clock += delta;
    this.trail += delta * 16 * phase.lit;
    this.breath += delta * 32 * phase.exhale;
    const emit = (exhale: boolean) => {
      if (this.particles.length >= 96) return;
      const n = this.clock * 17 + this.particles.length * 2.4;
      this.particles.push({
        p: (exhale ? this.mouth : this.tip).clone(),
        v: (exhale
          ? this.direction.clone().multiplyScalar(0.22)
          : new T.Vector3()
        ).add(
          new T.Vector3(
            Math.sin(n) * 0.016,
            exhale ? 0.035 : 0.065,
            Math.cos(n) * 0.012,
          ),
        ),
        age: 0,
        life: exhale ? 2 : 1.8,
        size: exhale ? 0.035 : 0.012,
        exhale,
      });
    };
    while (this.trail >= 1) {
      emit(false);
      this.trail--;
    }
    while (this.breath >= 1) {
      emit(true);
      this.breath--;
    }
    let count = 0;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += delta;
      if (p.age >= p.life) {
        this.particles.splice(i, 1);
        continue;
      }
      p.p.addScaledVector(p.v, delta);
      p.v.y += delta * 0.012;
      p.p.x += Math.sin(this.clock * 2 + i) * delta * 0.006;
      const t = p.age / p.life;
      this.transform.position.copy(p.p);
      this.transform.scale.setScalar(p.size + t * (p.exhale ? 0.17 : 0.065));
      this.transform.updateMatrix();
      this.smoke.setMatrixAt(count, this.transform.matrix);
      this.opacity.setX(
        count++,
        Math.sin(Math.PI * t) * (p.exhale ? 0.16 : 0.19),
      );
    }
    this.smoke.count = count;
    this.smoke.instanceMatrix.needsUpdate = true;
    this.opacity.needsUpdate = true;
  }
  clear() {
    if (!this.active) return;
    this.active = false;
    this.group.visible = false;
    this.light.intensity = 0;
    this.particles.length = 0;
    this.smoke.count = 0;
    this.trail = this.breath = 0;
  }
  dispose() {
    this.clear();
    this.group.removeFromParent();
    this.smoke.dispose();
    this.light.dispose();
    this.geometry.dispose();
    this.material.dispose();
    this.cigarette.traverse((o) => {
      if (o instanceof T.Mesh) {
        o.geometry.dispose();
        (o.material as T.Material).dispose();
      }
    });
  }
}

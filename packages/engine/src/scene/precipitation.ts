// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import { propRandom } from "../environment.ts";
import { LOOK } from "./look.ts";

export type Weather = "clear" | "rain" | "snow";

type Uniforms = Record<string, T.IUniform>;

/**
 * What the weather reads from the rest of the scene. All of it is optional so
 * the effect can be built on its own (tests, a scene without a post pipeline):
 * - `depth`: the post pipeline's resolved scene depth (`Post.depth`), for the
 *   soft fade where a streak or flake meets geometry;
 * - `light`: the street's practical lights (`StreetAir.light`), so rain and
 *   snow are dim in the dark and catch light near lamps and signs.
 */
export interface WeatherInputs {
  depth?: Uniforms;
  light?: Uniforms;
}

/** How many lamp light volumes the weather shaders can be lit by; `StreetAir` fills the same arrays. */
export const WEATHER_CONES = 12;
/** How many practical lights tint the fog and the weather; `StreetAir` fills the same arrays. */
export const GLOW_LAMPS = 6;

/** Metres of level the roof map covers from the origin, each way. */
const ROOF_REACH = 45;
const ROOF_TOP = 60;

/**
 * The level seen from straight above, as heights: one orthographic render of
 * the static scenery, each texel the topmost surface's world height. Rain and
 * snow read it in their vertex shaders to stop under roofs and awnings and to
 * land their splashes on whatever is below. Captured once (the caller hides
 * actors and overlays first); only static scenery shelters, so combat damage
 * never changes it.
 */
export class RoofMap {
  readonly uniforms = {
    roofMap: { value: null as T.Texture | null },
    roofMatrix: { value: new T.Matrix4() },
  };
  private readonly target = new T.WebGLRenderTarget(1024, 1024, {
    type: T.HalfFloatType,
    format: T.RedFormat,
    depthBuffer: true,
  });
  private readonly camera = new T.OrthographicCamera(
    -ROOF_REACH,
    ROOF_REACH,
    ROOF_REACH,
    -ROOF_REACH,
    0.5,
    ROOF_TOP + 5,
  );
  private readonly heights = new T.ShaderMaterial({
    side: T.DoubleSide,
    vertexShader: /* glsl */ `
      varying float vHeight;
      #include <common>
      #include <batching_pars_vertex>
      #include <skinning_pars_vertex>
      void main() {
        #include <batching_vertex>
        #include <skinbase_vertex>
        #include <begin_vertex>
        #include <skinning_vertex>
        #include <project_vertex>
        // The camera looks straight down from ROOF_TOP.
        vHeight = ${ROOF_TOP.toFixed(1)} + mvPosition.z;
      }`,
    fragmentShader: /* glsl */ `
      varying float vHeight;
      void main() { gl_FragColor = vec4(vHeight, 0., 0., 1.); }`,
  });

  constructor() {
    this.camera.position.set(0, ROOF_TOP, 0);
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();
    this.uniforms.roofMatrix.value.multiplyMatrices(
      this.camera.projectionMatrix,
      this.camera.matrixWorldInverse,
    );
    this.uniforms.roofMap.value = this.target.texture;
  }

  capture(renderer: T.WebGLRenderer, scene: T.Scene) {
    const { background, overrideMaterial } = scene;
    const shadows = renderer.shadowMap.needsUpdate;
    scene.background = null;
    scene.overrideMaterial = this.heights;
    renderer.setRenderTarget(this.target);
    try {
      renderer.render(scene, this.camera);
    } finally {
      scene.background = background;
      scene.overrideMaterial = overrideMaterial;
      renderer.setRenderTarget(null);
      // This render used up the pending shadow refresh on height materials; ask again.
      renderer.shadowMap.needsUpdate = shadows;
    }
  }

  dispose() {
    this.target.dispose();
    this.heights.dispose();
  }
}

/**
 * Rain or snow, one at a time, drawn in the post pipeline's air pass. Every
 * drop and flake is an instance of one quad whose position comes entirely from
 * the vertex shader: a per-instance seed, moved by one time uniform and wrapped
 * inside a volume that follows the camera's focus. Nothing is uploaded and no
 * JS runs per particle; a frame costs two uniform writes. Rain is one draw call
 * for the streaks (sharp near drops and a soft far veil in the same mesh), and
 * off battery saver one for the splash flecks and one for the bounce-spray over
 * open ground; snow is one. Snow allocates on first use.
 */
export class Precipitation {
  readonly group = new T.Group();
  private readonly uniforms: Uniforms;
  private readonly rain: Particles;
  private readonly splashes: Particles;
  private readonly spray: T.Mesh<T.PlaneGeometry, T.ShaderMaterial>;
  private snow?: Particles;
  private current: Weather = "rain";
  private battery = true;

  constructor(inputs: WeatherInputs = {}, roof?: RoofMap) {
    const { rain } = LOOK;
    this.uniforms = {
      ...standIns(),
      ...inputs.depth,
      ...inputs.light,
      ...roof?.uniforms,
      time: { value: 0 },
      center: { value: new T.Vector3(0, rain.volume[1] / 2, 0) },
      volume: { value: new T.Vector3(...rain.volume) },
      ambient: { value: new T.Color(0x252b3b) },
      /** World size of one pixel, one metre from the camera. */
      pixel: { value: 0.001 },
    };
    this.rain = particles(
      "GPU rain",
      rain.drops.smooth,
      0x5241494e,
      RAIN_VERTEX,
      RAIN_FRAGMENT,
      this.uniforms,
    );
    this.splashes = particles(
      "GPU rain splashes",
      rain.splashes,
      0x53504c41,
      SPLASH_VERTEX,
      SPLASH_FRAGMENT,
      this.uniforms,
    );
    const ground = new T.PlaneGeometry(ROOF_REACH * 2, ROOF_REACH * 2, 90, 90);
    ground.rotateX(-Math.PI / 2);
    this.spray = new T.Mesh(
      ground,
      airMaterial(SPRAY_VERTEX, SPRAY_FRAGMENT, this.uniforms),
    );
    this.spray.name = "GPU rain spray";
    this.spray.frustumCulled = false;
    this.group.add(this.spray, this.rain, this.splashes);
    this.setBatterySaver(true);
  }

  get kind() {
    return this.current;
  }
  /** Seconds the weather has run: the wet ground's ripples keep the same clock. */
  get time(): number {
    return this.uniforms.time.value;
  }
  get particles() {
    return this.current === "snow" ? this.snow!.geometry.instanceCount : 0;
  }
  /** Instances drawn for the current weather. */
  get instances() {
    if (this.current === "rain")
      return (
        this.rain.geometry.instanceCount +
        (this.splashes.visible ? this.splashes.geometry.instanceCount : 0)
      );
    return this.particles;
  }

  setKind(kind: Weather) {
    if (kind === "snow" && !this.snow) {
      this.snow = particles(
        "GPU snow",
        LOOK.snow.flakes.smooth,
        0x534e4f57,
        SNOW_VERTEX,
        SNOW_FRAGMENT,
        this.uniforms,
      );
      this.group.add(this.snow);
    }
    this.current = kind;
    this.setBatterySaver(this.battery);
  }

  /** Battery saver draws fewer drops and flakes, and neither splashes nor spray. */
  setBatterySaver(enabled: boolean) {
    this.battery = enabled;
    const tier = enabled ? "battery" : "smooth";
    this.rain.geometry.instanceCount = LOOK.rain.drops[tier];
    this.rain.visible = this.current === "rain";
    this.splashes.visible = this.spray.visible =
      this.current === "rain" && !enabled;
    if (this.snow) {
      this.snow.geometry.instanceCount = LOOK.snow.flakes[tier];
      this.snow.visible = this.current === "snow";
    }
  }

  /** Height of the drawing buffer and the camera: keeps far streaks and flakes at least a pixel wide. */
  setViewportHeight(pixels: number, camera?: T.PerspectiveCamera) {
    const slope = camera
      ? Math.tan(T.MathUtils.degToRad(camera.fov / 2))
      : 0.35;
    this.uniforms.pixel.value = (2 * slope) / Math.max(1, pixels);
  }

  /** The colour falling water and snow have with no lamp near: the scene's fog. */
  setAmbient(color: T.Color) {
    this.uniforms.ambient.value.copy(color);
  }

  /** Keep the volume around the camera's focus; particles hold their world positions as it moves. */
  follow(focus: T.Vector3) {
    this.uniforms.center.value.set(
      focus.x,
      this.uniforms.volume.value.y / 2,
      focus.z,
    );
  }

  update(dt: number) {
    if (this.current !== "clear") this.uniforms.time.value += dt;
  }

  dispose() {
    this.group.removeFromParent();
    for (const mesh of [this.rain, this.splashes, this.spray, this.snow]) {
      mesh?.geometry.dispose();
      mesh?.material.dispose();
    }
    this.group.clear();
  }
}

type Particles = T.Mesh<T.InstancedBufferGeometry, T.ShaderMaterial>;

/** Neutral values for everything the shaders read from elsewhere, for when nothing supplies it. */
function standIns(): Uniforms {
  const blank = new T.DataTexture(
    new Float32Array([1]),
    1,
    1,
    T.RedFormat,
    T.FloatType,
  );
  blank.needsUpdate = true;
  const low = new T.DataTexture(
    new Float32Array([-100]),
    1,
    1,
    T.RedFormat,
    T.FloatType,
  );
  low.needsUpdate = true;
  return {
    sceneDepth: { value: blank },
    resolution: { value: new T.Vector2(1, 1) },
    cameraNear: { value: 0.1 },
    cameraFar: { value: 180 },
    roofMap: { value: low },
    roofMatrix: { value: new T.Matrix4() },
    hfLamps: {
      value: Array.from({ length: GLOW_LAMPS }, () => new T.Vector4()),
    },
    hfLampColors: {
      value: Array.from({ length: GLOW_LAMPS }, () => new T.Color(0)),
    },
    hfGlowFalloff: { value: 0.03 },
    coneHeads: {
      value: Array.from(
        { length: WEATHER_CONES },
        () => new T.Vector3(0, -100, 0),
      ),
    },
    coneColors: {
      value: Array.from({ length: WEATHER_CONES }, () => new T.Color(0)),
    },
    coneShape: { value: new T.Vector2(2, 4) },
  };
}

function airMaterial(
  vertexShader: string,
  fragmentShader: string,
  uniforms: Uniforms,
) {
  return new T.ShaderMaterial({
    uniforms,
    vertexShader: SHARED_VERTEX + vertexShader,
    fragmentShader: AIR_FADE + fragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: T.DoubleSide,
    blending: T.AdditiveBlending,
    toneMapped: false,
  });
}

/** `count` instances of one quad, each with four fixed random numbers; nothing else is ever uploaded. */
function particles(
  name: string,
  count: number,
  seed: number,
  vertexShader: string,
  fragmentShader: string,
  uniforms: Uniforms,
): Particles {
  const random = propRandom(seed);
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = random();
  const geometry = new T.InstancedBufferGeometry();
  geometry.setAttribute(
    "position",
    new T.Float32BufferAttribute(
      [-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0],
      3,
    ),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.setAttribute("seed", new T.InstancedBufferAttribute(seeds, 4));
  geometry.instanceCount = count;
  const mesh = new T.Mesh(
    geometry,
    airMaterial(vertexShader, fragmentShader, uniforms),
  );
  mesh.name = name;
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * For anything drawn in the air pass: how much of a fragment `viewDepth` metres
 * from the camera survives the scene in front of it, easing in over `softness`
 * metres behind the surface instead of cutting a hard line. `lift` lets
 * something lying on a surface stay visible.
 */
export const AIR_FADE = /* glsl */ `
  uniform sampler2D sceneDepth; uniform vec2 resolution; uniform float cameraNear, cameraFar;
  float airFade(float viewDepth, float softness, float lift) {
    float d = texture2D(sceneDepth, gl_FragCoord.xy / resolution).x;
    float surface = (cameraNear * cameraFar) / (cameraFar - (cameraFar - cameraNear) * d);
    return smoothstep(0., softness, surface - viewDepth + lift);
  }`;

const SHARED_VERTEX = /* glsl */ `
  attribute vec4 seed;
  uniform float time, pixel, hfGlowFalloff;
  uniform vec3 center, volume, ambient;
  uniform sampler2D roofMap; uniform mat4 roofMatrix;
  uniform vec4 hfLamps[${GLOW_LAMPS}]; uniform vec3 hfLampColors[${GLOW_LAMPS}];
  uniform vec3 coneHeads[${WEATHER_CONES}]; uniform vec3 coneColors[${WEATHER_CONES}]; uniform vec2 coneShape;
  varying vec2 vUv; varying vec3 vLight; varying float vDepth; varying float vAlpha;

  /** Height of the topmost static surface over a point on the map. */
  float roofAt(vec2 xz) {
    vec4 at = roofMatrix * vec4(xz.x, 0., xz.y, 1.);
    return texture2D(roofMap, at.xy * .5 + .5).r;
  }
  /** A seeded position, wrapped into the volume around the camera's focus: stable in the world as the focus moves. */
  vec3 wrapped(vec3 p) { return mod(p - center + volume * .5, volume) - volume * .5 + center; }
  /** Light a particle catches: the fog's own colour, the practicals near it, and any lamp volume it is inside. */
  vec3 lightAt(vec3 p, float practicals, float unlit) {
    vec3 light = ambient * unlit;
    for (int i = 0; i < ${GLOW_LAMPS}; i++) {
      vec3 to = p - hfLamps[i].xyz;
      light += hfLampColors[i] * (step(1e-4, hfLamps[i].w) * practicals / (1. + dot(to, to) * hfGlowFalloff));
    }
    for (int i = 0; i < ${WEATHER_CONES}; i++) {
      vec3 to = p - coneHeads[i];
      float down = -to.y / coneShape.y;
      float edge = coneShape.x * down + .2;
      light += coneColors[i] * (step(0., down) * step(down, 1.) * smoothstep(edge, edge * .3, length(to.xz)) * mix(1., .3, down));
    }
    return light;
  }`;

const f = (n: number, digits = 3) => n.toFixed(digits);

/**
 * Two kinds of drop share the mesh: most are sharp streaks, the rest (the
 * veil) are wide, long and faint and only show at distance, where they merge
 * into the soft curtain far rain is. Every drop leans with the wind at its own
 * slightly different angle.
 */
const RAIN_VERTEX = /* glsl */ `
  void main() {
    vec3 fall = vec3(${f(LOOK.rain.wind[0], 2)}, ${f(-LOOK.rain.speed, 2)}, ${f(LOOK.rain.wind[1], 2)})
      + vec3(fract(seed.w * 31.7) - .5, 0., fract(seed.w * 57.3) - .5) * ${f(LOOK.rain.sway, 2)};
    float speed = mix(.75, 1.3, seed.w);
    float veil = step(${f(1 - LOOK.rain.veil, 2)}, fract(seed.w * 23.1));
    vec3 head = wrapped(seed.xyz * volume + fall * speed * time);
    vec3 toEye = cameraPosition - head;
    float reach = length(toEye);
    vec3 axis = normalize(fall);
    float near = 1. - smoothstep(2., 16., reach);
    // Near drops smear longer, wider and fainter; far ones shorten toward a haze of density.
    float streak = ${f(LOOK.rain.streak)} * speed * mix(.45, 1.9, pow(fract(seed.w * 7.31), 1.5)) * mix(1., 1.8, near) * mix(1., 2.4, veil);
    float width = ${f(LOOK.rain.width, 4)} * mix(1., 1.7, near) * mix(1., 9., veil);
    float least = pixel * reach * 1.15;
    float thin = min(1., width / least);
    vec3 p = head - axis * streak * position.y + normalize(cross(axis, toEye)) * max(width, least) * position.x;
    vUv = vec2(position.x + .5, position.y);
    vLight = lightAt(head, ${f(LOOK.rain.practicals, 2)}, ${f(LOOK.rain.ambient, 2)});
    float bright = mix(.2, 1., pow(fract(seed.w * 13.7), 2.));
    vAlpha = thin * bright * mix(1., .22, near * near) * smoothstep(1., 4.5, reach) * mix(1., ${f(LOOK.rain.veilStrength, 2)} * smoothstep(8., 30., reach), veil);
    vec4 mv = viewMatrix * vec4(p, 1.);
    vDepth = -mv.z;
    // Nothing falls below a roof or an awning.
    gl_Position = head.y > roofAt(head.xz) + .05 ? projectionMatrix * mv : vec4(2., 2., 2., 1.);
  }`;

const RAIN_FRAGMENT = /* glsl */ `
  varying vec2 vUv; varying vec3 vLight; varying float vDepth; varying float vAlpha;
  void main() {
    float across = 1. - abs(vUv.x * 2. - 1.);
    float along = smoothstep(0., .1, vUv.y) * pow(1. - vUv.y, 1.4);
    float a = across * across * along * vAlpha * airFade(vDepth, .5, 0.);
    gl_FragColor = vec4(vLight * (a * ${f(LOOK.rain.intensity)}), 1.);
  }`;

/**
 * Where drops land: a short-lived upright fleck with a tiny crown, standing on
 * whatever the roof map says is there. Lit like the rain, squared, so they
 * crowd the lamp pools and all but vanish on dark ground.
 */
const SPLASH_VERTEX = /* glsl */ `
  varying float vAge;
  void main() {
    float t = time * mix(5., 8., seed.w) + seed.z * 10.;
    float cycle = floor(t);
    vAge = fract(t);
    vec2 spot = fract(sin(vec2(dot(seed.xy + cycle * .137, vec2(127.1, 311.7)), dot(seed.xy + cycle * .071, vec2(269.5, 183.3)))) * 43758.5453);
    vec3 at = wrapped(vec3(spot.x * volume.x, 0., spot.y * volume.z));
    at.y = roofAt(at.xz);
    float reach = length(cameraPosition - at);
    // Never smaller than a couple of pixels, so they still read from the tactical camera.
    float size = max(${f(LOOK.rain.splash)} * mix(.6, 1.4, seed.z), pixel * reach * 1.4);
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 p = at + right * (position.x * size * (1. + vAge * 1.4)) + vec3(0., position.y * size * (.5 + sin(vAge * 3.1416)), 0.);
    vUv = vec2(position.x + .5, position.y);
    vec3 light = lightAt(at + vec3(0., .3, 0.), ${f(LOOK.rain.practicals, 2)}, ${f(LOOK.rain.ambient, 2)});
    vLight = light * (.35 + dot(light, vec3(.3333)) * 2.);
    vAlpha = 1. - vAge;
    vec4 mv = viewMatrix * vec4(p, 1.);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;

const SPLASH_FRAGMENT = /* glsl */ `
  varying vec2 vUv; varying vec3 vLight; varying float vDepth; varying float vAlpha; varying float vAge;
  void main() {
    float x = vUv.x * 2. - 1., y = vUv.y;
    // Two arms opening upward from a bright foot.
    float crown = smoothstep(.2, 0., abs(abs(x) - y * .7)) * smoothstep(1., .3, y);
    float foot = smoothstep(.55, 0., length(vec2(x, y * 2.5)));
    gl_FragColor = vec4(vLight * ((crown * .4 + foot) * vAlpha * airFade(vDepth, .1, .15) * ${f(LOOK.rain.splashIntensity)}), 1.);
  }`;

/** A thin drifting layer of bounce-spray just over open ground, lit per vertex like everything else in the air. */
const SPRAY_VERTEX = /* glsl */ `
  void main() {
    vec3 at = vec3(position.x, ${f(LOOK.rain.sprayHeight, 2)}, position.z);
    vUv = at.xz;
    vLight = lightAt(at, ${f(LOOK.rain.practicals, 2)}, ${f(LOOK.rain.ambient, 2)});
    // Only where rain reaches the ground.
    vAlpha = 1. - smoothstep(.2, .6, roofAt(at.xz));
    vec4 mv = viewMatrix * vec4(at, 1.);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;

const SPRAY_FRAGMENT = /* glsl */ `
  uniform float time;
  varying vec2 vUv; varying vec3 vLight; varying float vDepth; varying float vAlpha;
  float sprayHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float sprayNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
    return mix(mix(sprayHash(i), sprayHash(i + vec2(1, 0)), f.x), mix(sprayHash(i + vec2(0, 1)), sprayHash(i + vec2(1, 1)), f.x), f.y);
  }
  void main() {
    float mist = .35 + .65 * sprayNoise(vUv * 1.6 + time * vec2(-.45, .12)) * sprayNoise(vUv * 4.1 - time * vec2(.2, .35));
    float a = mist * vAlpha * airFade(vDepth, .3, 0.) * smoothstep(1.5, 6., vDepth);
    gl_FragColor = vec4(vLight * (a * ${f(LOOK.rain.spray)}), 1.);
  }`;

/**
 * One continuous population: small soft flakes whose size and brightness fall
 * off with distance on their own, a rare few of them large and very faint, as
 * if out of focus near the lens. Each flutters on its own layered sines and
 * all of them ride the same slow gusts.
 */
const SNOW_VERTEX = /* glsl */ `
  void main() {
    float phase = seed.w * 6.283 + time * (.55 + seed.x * .6);
    vec3 flutter = vec3(sin(phase) + .5 * sin(phase * 2.3 + seed.y * 9.), .25 * sin(phase * 1.3 + seed.z * 7.), cos(phase * .8) + .5 * sin(phase * 1.7 + seed.z * 5.)) * ${f(LOOK.snow.flutter, 2)};
    // Gusts: the wind's slow swell, integrated so a flake's path stays continuous.
    float gust = (1. - cos(time * .13)) / .13 * .22 + (1. - cos(time * .047 + 1.7)) / .047 * .1;
    vec3 travel = vec3(${f(LOOK.snow.wind, 2)} * time + gust, -mix(.6, 1.5, fract(seed.w * 3.7)) * ${f(LOOK.snow.speed, 2)} * time, gust * .35);
    vec3 at = wrapped(seed.xyz * volume + travel + flutter);
    float reach = length(cameraPosition - at);
    float big = step(${f(1 - LOOK.snow.large, 4)}, fract(seed.w * 91.7));
    float size = mix(${f(LOOK.snow.size[0])}, ${f(LOOK.snow.size[1])}, pow(fract(seed.w * 5.3), 2.)) * mix(1., 6., big);
    float least = pixel * reach * 1.6;
    float thin = min(1., size / least);
    size = max(size, least);
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    vec3 p = at + (right * position.x + up * (position.y - .5)) * size;
    vUv = vec2(position.x + .5, position.y);
    vLight = lightAt(at, ${f(LOOK.snow.practicals, 2)}, ${f(LOOK.snow.ambient, 2)});
    vAlpha = thin * thin * mix(.35, 1., fract(seed.w * 13.7)) * mix(1., .05, big) * smoothstep(.5, 2., reach);
    vec4 mv = viewMatrix * vec4(p, 1.);
    vDepth = -mv.z;
    gl_Position = at.y > roofAt(at.xz) + .03 ? projectionMatrix * mv : vec4(2., 2., 2., 1.);
  }`;

const SNOW_FRAGMENT = /* glsl */ `
  varying vec2 vUv; varying vec3 vLight; varying float vDepth; varying float vAlpha;
  void main() {
    vec2 d = vUv * 2. - 1.;
    float a = exp(-dot(d, d) * 3.5) * vAlpha * airFade(vDepth, .25, 0.);
    gl_FragColor = vec4(vLight * (a * ${f(LOOK.snow.intensity)}), 1.);
  }`;

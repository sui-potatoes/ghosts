// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import { LOOK } from "./look";
import { AIR_FADE, GLOW_LAMPS, WEATHER_CONES } from "./precipitation";

/** Height of a street lamp's head: where its light volume starts. */
const CONE_HEIGHT = 4.1;

type Uniforms = Record<string, T.IUniform>;
type Shader = Parameters<T.Material["onBeforeCompile"]>[0];

/** A street lamp head the scenery reports in `scene.userData.lamps`: x, y, z, colour. */
export type LampHead = readonly [number, number, number, number];

/** 1 while the street's lamps are on: lit window panes follow it. One encounter runs at a time. */
const paneNight = { value: 1 };
const paneUniforms = {
  paneNight,
  paneWarm: {
    value: new T.Color(LOOK.windows.warm).multiplyScalar(
      LOOK.windows.intensity,
    ),
  },
  paneCool: {
    value: new T.Color(LOOK.windows.cool).multiplyScalar(
      LOOK.windows.intensity,
    ),
  },
};

/**
 * Add one more shader patch to a material without losing the ones it has: the
 * earlier `onBeforeCompile` still runs first and the program cache key grows
 * by `tag`, so two materials share a program only when all their patches match.
 */
function extend<M extends T.Material>(
  material: M,
  tag: string,
  patch: (shader: Shader) => void,
): M {
  if (material.userData[tag]) return material;
  material.userData[tag] = true;
  const compile = material.onBeforeCompile,
    key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    compile.call(material, shader, renderer);
    patch(shader);
  };
  material.customProgramCacheKey = () => `${key}|${tag}`;
  material.needsUpdate = true;
  return material;
}

/**
 * Window panes that light up at night inside a batched facade. The material
 * must use vertex colours with an alpha channel: alpha 1 is a dark pane,
 * (1, 2] a warm room at that strength, (2, 3] a cool screen. Emissive only, so
 * daytime and the batch's draw calls are unchanged.
 */
export function litPanes<M extends T.MeshStandardMaterial>(material: M): M {
  return extend(material, "lit-panes-v1", (shader) => {
    Object.assign(shader.uniforms, paneUniforms);
    shader.fragmentShader =
      "uniform float paneNight; uniform vec3 paneWarm, paneCool;\n" +
      shader.fragmentShader.replace(
        "#include <emissivemap_fragment>",
        /* glsl */ `#include <emissivemap_fragment>
        #ifdef USE_COLOR_ALPHA
          float paneLight = vColor.a - 1.;
          totalEmissiveRadiance += (paneLight > 1. ? paneCool * (paneLight - 1.) : paneWarm * max(paneLight, 0.)) * paneNight;
        #endif`,
      );
  });
}

/**
 * The air of an outdoor street, on top of the scene's own `FogExp2`:
 *
 * - Height fog. Every fogged material gets the same extra term, patched into
 *   three's fog chunks: fog that is dense at the ground and thins with height
 *   (integrated along the view ray, so it is right from any camera height),
 *   coming in with distance so the play area stays clear, in the preset's fog
 *   colour, warmed by the lit practicals near the surface. It rides on the
 *   scene's `fogColor` and `fogDensity`, is weaker the brighter the fog is
 *   (`setLit`) and never covers more than `LOOK.heightFog.cap`.
 * - Snow cover, in the same patch: while it snows, up-facing surfaces of
 *   standard materials take a noisy dusting, thinner under roofs and awnings
 *   (the weather's roof map).
 * - Light volumes. One instanced, additive cone under every lamp head the
 *   scenery reported, drawn in the post pipeline's air pass where it can fade
 *   softly into whatever it meets. One draw call; hidden when the lamps are off.
 * - `light`: the practicals as uniforms, shared with the weather so rain and
 *   snow are lit by the same lamps.
 * - Night switches the scenery has no light for: lit window panes and the far
 *   street's sign boxes.
 *
 * Nothing here runs per object per frame, and nothing asks for a frame.
 */
export class StreetAir {
  /** The lamps' light volumes; add to the air scene. */
  readonly cones: T.InstancedMesh<T.ConeGeometry, T.ShaderMaterial>;
  /** The practical lights, for anything else lit by them (`Precipitation`). */
  readonly light = {
    hfGlowFalloff: { value: 1 / LOOK.heightFog.glowRadius ** 2 },
    hfLamps: {
      value: Array.from({ length: GLOW_LAMPS }, () => new T.Vector4()),
    },
    hfLampColors: {
      value: Array.from({ length: GLOW_LAMPS }, () => new T.Color(0)),
    },
    coneHeads: {
      value: Array.from(
        { length: WEATHER_CONES },
        () => new T.Vector3(0, -100, 0),
      ),
    },
    coneColors: {
      value: Array.from({ length: WEATHER_CONES }, () => new T.Color(0)),
    },
    coneShape: { value: new T.Vector2(LOOK.cones.radius, CONE_HEIGHT) },
  };
  /** Materials carrying the street's patch so far (QA: grows when debris joins). */
  patched = 0;
  private readonly surface: Uniforms;
  private readonly heads: LampHead[];
  private readonly signs: T.MeshBasicMaterial[];

  /**
   * `depth` is the post pipeline's scene depth (`Post.depth`), for the volumes'
   * soft fade; `roof` the weather's roof map (`RoofMap.uniforms`), for snow
   * that thins under cover. `heightFog` false keeps only the scene's own fog
   * (reference shots).
   */
  constructor(
    scene: T.Scene,
    depth: Uniforms = {},
    roof: Uniforms = {},
    private readonly heightFog = true,
  ) {
    this.surface = {
      roofMap: { value: null },
      roofMatrix: { value: new T.Matrix4() },
      ...roof,
      ...this.light,
      hfDensity: { value: LOOK.heightFog.density },
      hfFalloff: { value: LOOK.heightFog.falloff },
      hfClear: {
        value: new T.Vector3(...LOOK.heightFog.clear, LOOK.heightFog.cap),
      },
      snowCover: { value: 0 },
      snowColor: { value: new T.Color(LOOK.snow.ground) },
    };
    // The strongest practical lights tint the fog and the weather around them.
    const lights: T.Light[] = [];
    scene.traverse((o) => {
      if (o instanceof T.Light && typeof o.userData.nightIntensity === "number")
        lights.push(o);
    });
    lights.sort(
      (a, b) => b.userData.nightIntensity - a.userData.nightIntensity,
    );
    lights.slice(0, GLOW_LAMPS).forEach((light, i) => {
      const at = light.getWorldPosition(new T.Vector3());
      this.light.hfLamps.value[i].set(at.x, Math.min(at.y, 2.2), at.z, 0);
      this.light.hfLampColors.value[i].copy(light.color);
    });

    this.heads = (scene.userData.lamps ?? []).slice(0, WEATHER_CONES);
    this.signs = scene.userData.nightSigns ?? [];
    for (const sign of this.signs)
      sign.userData.dayColor ??= sign.color.clone();
    const geometry = new T.ConeGeometry(
      LOOK.cones.radius,
      CONE_HEIGHT,
      28,
      1,
      true,
    );
    geometry.translate(0, -CONE_HEIGHT / 2, 0);
    this.cones = new T.InstancedMesh(
      geometry,
      coneMaterial(depth),
      this.heads.length,
    );
    const place = new T.Matrix4(),
      tint = new T.Color();
    this.heads.forEach(([x, y, z, color], i) => {
      this.cones.setMatrixAt(i, place.makeTranslation(x, y, z));
      this.cones.setColorAt(i, tint.setHex(color));
      this.light.coneHeads.value[i].set(x, y, z);
    });
    this.cones.name = "Street lamp light volumes";
    this.cones.frustumCulled = false;
    this.setLit(true, scene);
  }

  /**
   * Give every fogged material under `root` the street's surface patch: the
   * height fog, and on standard materials the snow cover. Safe to call again
   * for new objects (debris); materials already done are skipped.
   */
  fog(root: T.Object3D) {
    const { surface } = this;
    eachMaterial(root, (m) => {
      if (!(m as T.Material & { fog?: boolean }).fog || m.userData[SURFACE])
        return;
      this.patched++;
      extend(m, SURFACE, (shader) => {
        if (!shader.fragmentShader.includes("#include <fog_fragment>")) return;
        Object.assign(shader.uniforms, surface);
        shader.vertexShader = shader.vertexShader
          .replace(
            "#include <fog_pars_vertex>",
            "#include <fog_pars_vertex>\n" + PARS_VERTEX,
          )
          .replace("#include <fog_vertex>", "#include <fog_vertex>\n" + VERTEX);
        shader.fragmentShader = shader.fragmentShader
          .replace(
            "#include <fog_pars_fragment>",
            "#include <fog_pars_fragment>\n" + PARS_FRAGMENT,
          )
          .replace(
            "#include <lights_physical_fragment>",
            SNOW + "\n#include <lights_physical_fragment>",
          )
          .replace("#include <fog_fragment>", FRAGMENT);
      });
    });
  }

  /** The lamps are on (evening, night) or off; `scene` supplies the fog everything here rides on. */
  setLit(lit: boolean, scene: T.Scene) {
    const fog = scene.fog instanceof T.FogExp2 ? scene.fog : null;
    this.cones.visible = lit && this.cones.count > 0;
    this.cones.material.uniforms.density.value = fog?.density ?? 0;
    // The same extinction reads far hazier in pale fog than in dark: scale it by the fog's own brightness.
    const luminance = fog
      ? fog.color.r * 0.2126 + fog.color.g * 0.7152 + fog.color.b * 0.0722
      : 0;
    this.surface.hfDensity.value = this.heightFog
      ? LOOK.heightFog.density / (1 + LOOK.heightFog.bright * luminance)
      : 0;
    this.light.hfLamps.value.forEach(
      (lamp) => (lamp.w = lit ? LOOK.heightFog.glow : 0),
    );
    this.heads.forEach(([, , , color], i) =>
      this.light.coneColors.value[i].setHex(lit ? color : 0),
    );
    paneNight.value = lit ? 1 : 0;
    for (const sign of this.signs)
      sign.color
        .copy(sign.userData.dayColor)
        .multiplyScalar(lit ? LOOK.signs.far : 1);
  }

  /** Dust up-facing surfaces with snow, or clear it. */
  setSnow(snowing: boolean) {
    this.surface.snowCover.value = snowing ? LOOK.snow.cover : 0;
  }

  /** Drift the volumes' noise; call only from a frame that is being drawn anyway. */
  update(time: number) {
    this.cones.material.uniforms.time.value = time;
  }

  dispose() {
    this.cones.removeFromParent();
    this.cones.geometry.dispose();
    this.cones.material.dispose();
    this.cones.dispose();
  }
}

const SURFACE = "street-surface-v4";

function eachMaterial(root: T.Object3D, visit: (material: T.Material) => void) {
  root.traverse((o) => {
    const materials = (o as T.Mesh).material;
    if (!materials) return;
    for (const m of Array.isArray(materials) ? materials : [materials])
      visit(m);
  });
}

const PARS_VERTEX = /* glsl */ `
#ifdef USE_FOG
  varying vec3 vFogWorld;
#endif`;

/** The view-space position back in the world: correct for skinned, instanced and batched meshes alike. */
const VERTEX = /* glsl */ `
#ifdef USE_FOG
  vFogWorld = mvPosition.xyz * mat3(viewMatrix) + cameraPosition;
#endif`;

const PARS_FRAGMENT = /* glsl */ `
#if defined(USE_FOG) && defined(FOG_EXP2)
  varying vec3 vFogWorld;
  uniform float hfDensity, hfFalloff, hfGlowFalloff, snowCover;
  uniform vec3 hfClear, snowColor;
  uniform vec4 hfLamps[${GLOW_LAMPS}];
  uniform vec3 hfLampColors[${GLOW_LAMPS}];
  uniform sampler2D roofMap; uniform mat4 roofMatrix;
  float snowHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float snowNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
    return mix(mix(snowHash(i), snowHash(i + vec2(1, 0)), f.x), mix(snowHash(i + vec2(0, 1)), snowHash(i + vec2(1, 1)), f.x), f.y);
  }
#endif`;

/** A dusting on whatever faces the sky: patchy, thin under cover, matte and faintly cool. Standard materials only. */
const SNOW = /* glsl */ `
#if defined(USE_FOG) && defined(FOG_EXP2)
  if (snowCover > 0.) {
    float snowUp = (normal * mat3(viewMatrix)).y;
    vec4 snowAt = roofMatrix * vec4(vFogWorld.x, 0., vFogWorld.z, 1.);
    float snowOpen = smoothstep(1.2, .3, texture2D(roofMap, snowAt.xy * .5 + .5).r - vFogWorld.y);
    float snowGrain = snowNoise(vFogWorld.xz * 1.3) * .55 + snowNoise(vFogWorld.xz * 5.1) * .3 + snowNoise(vFogWorld.xz * 19.) * .15;
    float snowAmount = snowCover * smoothstep(.55, .92, snowUp) * mix(.1, 1., snowOpen) * smoothstep(.22, .62, snowGrain);
    diffuseColor.rgb = mix(diffuseColor.rgb, snowColor, snowAmount);
    roughnessFactor = mix(roughnessFactor, .92, snowAmount);
    metalnessFactor *= 1. - snowAmount;
  }
#endif`;

/**
 * The scene's fog and the height fog, replacing three's fog chunk. Three fogs
 * a fragment after tone mapping and colour conversion, in display space, and
 * the presets' densities were authored for that. Drawn into the post
 * pipeline's linear target the same mix lands several times heavier (a pale
 * fog over a dark street most of all), so there the mix is done on
 * gamma-encoded values, which puts the fog back where the presets had it.
 * Straight to the canvas (TONE_MAPPING is defined) it is three's own mix.
 * The height fog has density `d0 * exp(-falloff * y)`, integrated from the
 * camera to the surface.
 */
const FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1. - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
    float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  #ifdef TONE_MAPPING
    #define airMix(a, b, t) mix(a, b, t)
  #else
    #define airMix(a, b, t) pow(mix(pow(max(a, 0.), vec3(1. / 2.2)), pow(max(b, 0.), vec3(1. / 2.2)), t), vec3(2.2))
  #endif
#endif
#if defined(USE_FOG) && defined(FOG_EXP2)
  vec3 hfRay = vFogWorld - cameraPosition;
  float hfRise = hfFalloff * hfRay.y;
  float hfEye = exp(-hfFalloff * max(cameraPosition.y, 0.));
  float hfThrough = abs(hfRise) > 1e-3 ? (hfEye - exp(-hfFalloff * max(vFogWorld.y, 0.))) / hfRise : hfEye;
  float hfAmount = 1. - exp(-fogDensity * hfDensity * length(hfRay) * max(hfThrough, 0.));
  hfAmount = min(hfAmount, hfClear.z) * smoothstep(hfClear.x, hfClear.y, length(hfRay.xz));
  vec3 hfColor = fogColor;
  for (int i = 0; i < ${GLOW_LAMPS}; i++) {
    vec3 hfTo = vFogWorld - hfLamps[i].xyz;
    hfColor += hfLampColors[i] * (hfLamps[i].w / (1. + dot(hfTo, hfTo) * hfGlowFalloff));
  }
  gl_FragColor.rgb = airMix(gl_FragColor.rgb, hfColor, hfAmount);
#endif
#ifdef USE_FOG
  gl_FragColor.rgb = airMix(gl_FragColor.rgb, fogColor, fogFactor);
#endif`;

function coneMaterial(depth: Uniforms) {
  return new T.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: T.DoubleSide,
    blending: T.AdditiveBlending,
    toneMapped: false,
    uniforms: {
      sceneDepth: { value: null },
      resolution: { value: new T.Vector2(1, 1) },
      cameraNear: { value: 0.1 },
      cameraFar: { value: 180 },
      ...depth,
      time: { value: 0 },
      density: { value: 0 },
      intensity: { value: LOOK.cones.intensity },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld; varying vec3 vNormal; varying vec3 vTint; varying float vDown; varying float vDepth;
      void main() {
        vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.);
        vWorld = world.xyz;
        vNormal = normal;
        vDown = -position.y / ${CONE_HEIGHT.toFixed(2)};
        #ifdef USE_INSTANCING_COLOR
          vTint = instanceColor;
        #else
          vTint = vec3(1.);
        #endif
        vec4 mv = viewMatrix * world;
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader:
      AIR_FADE +
      /* glsl */ `
      uniform float time, density, intensity;
      varying vec3 vWorld; varying vec3 vNormal; varying vec3 vTint; varying float vDown; varying float vDepth;
      void main() {
        vec3 toEye = cameraPosition - vWorld;
        float reach = length(toEye);
        // Thick through the middle, nothing at the silhouette: it reads as a volume, not a shell.
        float body = smoothstep(0., .85, abs(dot(normalize(vNormal), toEye / reach)));
        // Brightest under the head, thinning toward the ground.
        float fall = mix(1., .16, smoothstep(0., .95, vDown)) * smoothstep(1., .8, vDown) * smoothstep(0., .04, vDown);
        float drift = .78 + .22 * sin(vWorld.x * 2.3 + time * .35) * sin(vWorld.y * 1.9 - time * .8 + vWorld.z * 1.4);
        float air = exp(-density * density * reach * reach) * smoothstep(1.5, 5., reach);
        float meet = airFade(vDepth, ${LOOK.cones.soft.toFixed(2)}, 0.);
        gl_FragColor = vec4(vTint * (intensity * body * fall * drift * air * meet), 1.);
      }`,
  });
}

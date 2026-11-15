// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import type { RenderMode } from "../render-policy";
import { LOOK } from "./look";

/**
 * The match scene's post pipeline, on the shared WebGL renderer. The scene is
 * drawn once into a multisampled half-float target (so edges are resolved
 * before any effect and nothing clips), then a handful of small full-screen
 * passes build the frame:
 *
 *   air      the air scene, when one is given: additive things that live in
 *            the air (lamp light volumes, rain, snow), drawn into their own
 *            target after the scene so they can read its resolved depth
 *            (`depth`, `AIR_FADE` in precipitation.ts) and fade softly into
 *            geometry instead of cutting it
 *   half     a filtered half-resolution copy of scene plus air: the bloom's
 *            source and the tilt-shift's soft image
 *   ao       contact shading from the depth buffer at half resolution, then a
 *            depth-aware blur (full stack only)
 *   bloom    bright parts of `half`, blurred down a mip chain and back up
 *   frame    one pass to the canvas: tilt-shift, contact shading, bloom,
 *            exposure and ACES (the renderer's own `toneMappingExposure`),
 *            the grade, vignette, static grain, sRGB
 *
 * Battery saver runs bloom and the final pass only. Nothing here is animated:
 * a frame is a pure function of the scene, so render-on-demand is untouched.
 * Only `render` goes through the pipeline; portraits, the reflection probe and
 * anything else that calls `renderer.render` draw as before, and the render
 * target is always back on the canvas when `render` returns. Dials: `look.ts`.
 */
export class Post {
  private readonly quad = new FullScreenQuad();
  private readonly sceneTarget: T.WebGLRenderTarget;
  private readonly half = target();
  private readonly airTarget = target();
  private airDrawn = false;
  /** The resolved scene depth, for materials drawn in the air scene (`AIR_FADE`). */
  readonly depth = {
    sceneDepth: { value: null as T.Texture | null },
    resolution: { value: new T.Vector2(1, 1) },
    cameraNear: { value: 0.1 },
    cameraFar: { value: 180 },
  };
  private readonly aoRaw = target(T.RGFormat);
  private readonly aoSoft = target(T.RGFormat);
  private readonly mips = Array.from({ length: LOOK.bloom.levels.smooth }, () =>
    target(),
  );
  private readonly copyDown = material(DOWN);
  private readonly halfDown = material(DOWN, { AIR: "" });
  private readonly brightDown = material(DOWN, { THRESHOLD: "" });
  private readonly up = material(
    UP,
    {},
    { transparent: true, blending: T.NormalBlending },
  );
  private readonly ao = material(AO, { SAMPLES: LOOK.ao.samples });
  private readonly aoBlur = material(AO_BLUR);
  private readonly frames = {
    smooth: material(FRAME, { FULL: "" }),
    battery: material(FRAME),
  };
  private mode: RenderMode = "battery";

  constructor(private readonly renderer: T.WebGLRenderer) {
    this.sceneTarget = new T.WebGLRenderTarget(1, 1, {
      type: T.HalfFloatType,
      samples: 4,
      depthTexture: new T.DepthTexture(1, 1, T.UnsignedIntType),
    });
    const { bloom, ao, focus, grade, vignette } = LOOK;
    const set = (m: T.ShaderMaterial, values: Record<string, unknown>) => {
      for (const [name, value] of Object.entries(values))
        m.uniforms[name] = { value };
    };
    this.depth.sceneDepth.value = this.sceneTarget.depthTexture;
    set(this.copyDown, { map: null, texel: new T.Vector2() });
    set(this.halfDown, {
      map: null,
      texel: new T.Vector2(),
      airMap: this.airTarget.texture,
    });
    set(this.brightDown, {
      map: null,
      texel: new T.Vector2(),
      threshold: bloom.threshold,
      knee: bloom.knee,
      ceiling: bloom.ceiling,
      exposure: 1,
    });
    set(this.up, { map: null, texel: new T.Vector2(), spread: bloom.spread });
    set(this.ao, {
      depthMap: this.sceneTarget.depthTexture,
      texel: new T.Vector2(),
      proj: null,
      near: 0.1,
      far: 100,
      radius: ao.radius,
    });
    set(this.aoBlur, { map: this.aoRaw.texture, texel: new T.Vector2() });
    for (const frame of Object.values(this.frames))
      set(frame, {
        sceneMap: this.sceneTarget.texture,
        airMap: this.airTarget.texture,
        halfMap: this.half.texture,
        bloomMap: this.mips[0].texture,
        aoMap: this.aoSoft.texture,
        depthMap: this.sceneTarget.depthTexture,
        bloomTexel: new T.Vector2(),
        toneMappingExposure: 1,
        near: 0.1,
        far: 100,
        bloomIntensity: bloom.intensity,
        aoStrength: ao.strength,
        aoFade: new T.Vector2(...ao.fade),
        focusNear: new T.Vector2(...focus.near),
        focusFar: new T.Vector2(...focus.far),
        focusAmount: focus.amount,
        contrast: grade.contrast,
        saturation: grade.saturation,
        split: grade.split,
        shadows: new T.Color(grade.shadows),
        highlights: new T.Color(grade.highlights),
        vignette: new T.Vector3(
          vignette.start,
          vignette.end,
          vignette.strength,
        ),
        grain: LOOK.grain,
      });
  }

  /** Battery saver keeps bloom and the grade; the full stack adds contact shading and tilt-shift. */
  setMode(mode: RenderMode) {
    this.mode = mode;
  }

  /** Bloom only what glows: under the sun that takes a much higher threshold than under lamps. */
  setDaylight(daylight: boolean) {
    this.brightDown.uniforms.threshold.value = daylight
      ? LOOK.bloom.daylight
      : LOOK.bloom.threshold;
  }

  /** Match the renderer's drawing buffer; call after the renderer was resized. */
  resize() {
    const { x: width, y: height } = this.renderer.getDrawingBufferSize(
      new T.Vector2(),
    );
    const size = (divisor: number) =>
      [
        Math.max(1, Math.ceil(width / divisor)),
        Math.max(1, Math.ceil(height / divisor)),
      ] as const;
    this.sceneTarget.setSize(width, height);
    this.airTarget.setSize(width, height);
    this.depth.resolution.value.set(width, height);
    for (const half of [this.half, this.aoRaw, this.aoSoft])
      half.setSize(...size(2));
    this.mips.forEach((mip, i) => mip.setSize(...size(4 << i)));
  }

  /** Run `compile` with the scene target bound, so warmed programs are the ones `render` uses. */
  compiling<R>(compile: () => R): R {
    this.renderer.setRenderTarget(this.sceneTarget);
    try {
      return compile();
    } finally {
      this.renderer.setRenderTarget(null);
    }
  }

  /** Draw a frame of `scene`, with `air` (additive, depth-faded: see the class note) laid over it. */
  render(scene: T.Scene, camera: T.PerspectiveCamera, air?: T.Scene) {
    const { renderer, sceneTarget, half, mips } = this;
    const full = this.mode === "smooth";
    const levels = LOOK.bloom.levels[this.mode];
    const exposure = renderer.toneMappingExposure;
    const autoClear = renderer.autoClear;
    try {
      renderer.setRenderTarget(sceneTarget);
      renderer.render(scene, camera);

      // The air layer: drawn only while something is in it, cleared once when it empties.
      const airy = !!air && shown(air);
      if (airy || this.airDrawn) {
        this.depth.cameraNear.value = camera.near;
        this.depth.cameraFar.value = camera.far;
        renderer.setRenderTarget(this.airTarget);
        if (airy) renderer.render(air!, camera);
        else renderer.clear();
        this.airDrawn = airy;
      }

      this.draw(this.halfDown, half, sceneTarget);
      if (full) {
        const u = this.ao.uniforms;
        u.texel.value.set(1 / sceneTarget.width, 1 / sceneTarget.height);
        u.proj.value = camera.projectionMatrix;
        u.near.value = camera.near;
        u.far.value = camera.far;
        this.draw(this.ao, this.aoRaw);
        this.aoBlur.uniforms.texel.value.set(
          1 / this.aoRaw.width,
          1 / this.aoRaw.height,
        );
        this.draw(this.aoBlur, this.aoSoft);
      }

      this.brightDown.uniforms.exposure.value = exposure;
      this.draw(this.brightDown, mips[0], half);
      for (let i = 1; i < levels; i++)
        this.draw(this.copyDown, mips[i], mips[i - 1]);
      // Each wider level is laid over the one above it, in place.
      renderer.autoClear = false;
      for (let i = levels - 1; i > 0; i--)
        this.draw(this.up, mips[i - 1], mips[i]);
      renderer.autoClear = autoClear;

      const frame = this.frames[this.mode];
      const u = frame.uniforms;
      u.toneMappingExposure.value = exposure;
      u.bloomTexel.value.set(1 / mips[0].width, 1 / mips[0].height);
      u.near.value = camera.near;
      u.far.value = camera.far;
      this.draw(frame, null);
    } finally {
      renderer.autoClear = autoClear;
      renderer.setRenderTarget(null);
    }
  }

  private draw(
    pass: T.ShaderMaterial,
    to: T.WebGLRenderTarget | null,
    from?: T.WebGLRenderTarget,
  ) {
    if (from) {
      pass.uniforms.map.value = from.texture;
      pass.uniforms.texel.value.set(1 / from.width, 1 / from.height);
    }
    this.quad.material = pass;
    this.renderer.setRenderTarget(to);
    this.quad.render(this.renderer);
  }

  dispose() {
    for (const t of [
      this.sceneTarget,
      this.half,
      this.airTarget,
      this.aoRaw,
      this.aoSoft,
      ...this.mips,
    ])
      t.dispose();
    for (const m of [
      this.copyDown,
      this.halfDown,
      this.brightDown,
      this.up,
      this.ao,
      this.aoBlur,
      ...Object.values(this.frames),
    ])
      m.dispose();
    this.quad.dispose();
  }
}

/** Whether anything under `object` would draw. */
function shown(object: T.Object3D): boolean {
  return (
    object.visible &&
    (object.children.length ? object.children.some(shown) : true)
  );
}

function target(format: T.PixelFormat = T.RGBAFormat) {
  return new T.WebGLRenderTarget(1, 1, {
    type: T.HalfFloatType,
    format,
    depthBuffer: false,
  });
}

function material(
  fragmentShader: string,
  defines: Record<string, unknown> = {},
  extra: T.ShaderMaterialParameters = {},
) {
  return new T.ShaderMaterial({
    vertexShader:
      "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }",
    fragmentShader,
    defines,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    ...extra,
  });
}

/** A 13-tap downsample that does not shimmer; with THRESHOLD it keeps only what is bright after exposure. */
const DOWN = /* glsl */ `
  uniform sampler2D map; uniform vec2 texel;
  uniform float threshold, knee, ceiling, exposure;
  varying vec2 vUv;
  #ifdef AIR
    uniform sampler2D airMap;
    vec3 tap(float x, float y) { vec2 uv = vUv + vec2(x, y) * texel; return texture2D(map, uv).rgb + texture2D(airMap, uv).rgb; }
  #else
    vec3 tap(float x, float y) { return texture2D(map, vUv + vec2(x, y) * texel).rgb; }
  #endif
  void main() {
    vec3 color = tap(0., 0.) * .125
      + (tap(-2., 2.) + tap(2., 2.) + tap(-2., -2.) + tap(2., -2.)) * .03125
      + (tap(0., 2.) + tap(-2., 0.) + tap(2., 0.) + tap(0., -2.)) * .0625
      + (tap(-1., 1.) + tap(1., 1.) + tap(-1., -1.) + tap(1., -1.)) * .125;
    #ifdef THRESHOLD
      float level = dot(color, vec3(.2126, .7152, .0722)) * exposure;
      float soft = clamp(level - threshold + knee, 0., 2. * knee);
      soft = soft * soft / (4. * knee + 1e-4);
      // What bloom is fed is capped in luminance, not per channel: a hot highlight
      // spreads as a glow in its own colour instead of clipping to a white disc.
      color *= min(max(soft, level - threshold), ceiling) / max(level, 1e-4);
    #endif
    gl_FragColor = vec4(max(color, 0.), 1.);
  }`;

/** A 3x3 tent upsample, blended over the level it lands on. */
const UP = /* glsl */ `
  uniform sampler2D map; uniform vec2 texel; uniform float spread;
  varying vec2 vUv;
  vec3 tap(float x, float y) { return texture2D(map, vUv + vec2(x, y) * texel).rgb; }
  void main() {
    vec3 color = tap(0., 0.) * .25
      + (tap(-1., 0.) + tap(1., 0.) + tap(0., -1.) + tap(0., 1.)) * .125
      + (tap(-1., -1.) + tap(1., -1.) + tap(-1., 1.) + tap(1., 1.)) * .0625;
    gl_FragColor = vec4(color, spread);
  }`;

/** Hemisphere contact shading from depth alone; writes (shading, distance). */
const AO = /* glsl */ `
  #include <packing>
  uniform sampler2D depthMap; uniform vec2 texel; uniform mat4 proj;
  uniform float near, far, radius;
  varying vec2 vUv;
  float viewZ(vec2 uv) { return perspectiveDepthToViewZ(texture2D(depthMap, uv).x, near, far); }
  vec3 viewAt(vec2 uv) {
    float z = viewZ(uv);
    return vec3((uv * 2. - 1.) * vec2(-z / proj[0][0], -z / proj[1][1]), z);
  }
  void main() {
    if (texture2D(depthMap, vUv).x >= 1.) { gl_FragColor = vec4(1., far, 0., 1.); return; }
    vec3 p = viewAt(vUv);
    // The normal from the nearer neighbour on each axis, so silhouettes do not bend it.
    vec3 x1 = viewAt(vUv + vec2(texel.x, 0.)) - p, x0 = p - viewAt(vUv - vec2(texel.x, 0.));
    vec3 y1 = viewAt(vUv + vec2(0., texel.y)) - p, y0 = p - viewAt(vUv - vec2(0., texel.y));
    vec3 n = normalize(cross(abs(x1.z) < abs(x0.z) ? x1 : x0, abs(y1.z) < abs(y0.z) ? y1 : y0));
    vec3 t = normalize(abs(n.y) < .9 ? cross(n, vec3(0., 1., 0.)) : cross(n, vec3(1., 0., 0.)));
    vec3 b = cross(n, t);
    float noise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(.06711056, .00583715))));
    float occluded = 0.;
    for (int i = 0; i < SAMPLES; i++) {
      float turn = (float(i) + noise) * 2.39996;
      float r = sqrt((float(i) + .5) / float(SAMPLES));
      vec3 dir = t * (cos(turn) * r) + b * (sin(turn) * r) + n * sqrt(1. - r * r);
      vec3 s = p + dir * radius * mix(.25, 1., fract(noise + float(i) * .618));
      vec4 clip = proj * vec4(s, 1.);
      float z = viewZ(clip.xy / clip.w * .5 + .5);
      // Nearer than the sample, and near enough to be the same piece of the world.
      occluded += step(s.z + .03, z) * smoothstep(0., 1., radius / max(abs(p.z - z), 1e-3));
    }
    gl_FragColor = vec4(1. - occluded / float(SAMPLES), -p.z, 0., 1.);
  }`;

/** A 4x4 blur that averages the shading's dither without crossing depth edges. */
const AO_BLUR = /* glsl */ `
  uniform sampler2D map; uniform vec2 texel;
  varying vec2 vUv;
  void main() {
    float z = texture2D(map, vUv).g, sum = 0., weight = 0.;
    for (int x = 0; x < 4; x++) for (int y = 0; y < 4; y++) {
      vec2 s = texture2D(map, vUv + (vec2(float(x), float(y)) - 1.5) * texel).rg;
      float w = max(0., 1. - abs(s.g - z) / (.04 * z + .08));
      sum += s.r * w; weight += w;
    }
    gl_FragColor = vec4(weight > 0. ? sum / weight : 1., z, 0., 1.);
  }`;

/** Everything that happens once per pixel, in one pass to the canvas. */
const FRAME = /* glsl */ `
  #include <common>
  #include <packing>
  #include <tonemapping_pars_fragment>
  uniform sampler2D sceneMap, airMap, halfMap, bloomMap, aoMap, depthMap;
  uniform vec2 bloomTexel, aoFade, focusNear, focusFar;
  uniform float near, far, bloomIntensity, aoStrength, focusAmount, contrast, saturation, split, grain;
  uniform vec3 shadows, highlights, vignette;
  varying vec2 vUv;
  vec3 glow(float x, float y) { return texture2D(bloomMap, vUv + vec2(x, y) * bloomTexel).rgb; }
  void main() {
    vec3 color = texture2D(sceneMap, vUv).rgb + texture2D(airMap, vUv).rgb;
    #ifdef FULL
      float z = -perspectiveDepthToViewZ(texture2D(depthMap, vUv).x, near, far);
      // Tilt-shift: only what is far beyond or right in front of the play area softens.
      float soft = max(1. - smoothstep(focusNear.x, focusNear.y, z), smoothstep(focusFar.x, focusFar.y, z));
      color = mix(color, texture2D(halfMap, vUv).rgb, soft * focusAmount);
      // Contact shading seats objects; it leaves lit signs and fogged distance alone.
      float shade = pow(texture2D(aoMap, vUv).r, aoStrength);
      float keep = max(smoothstep(aoFade.x, aoFade.y, z), smoothstep(.7, 1.8, luminance(color) * toneMappingExposure));
      color *= mix(shade, 1., keep);
    #endif
    color += (glow(0., 0.) * .25
      + (glow(-1., 0.) + glow(1., 0.) + glow(0., -1.) + glow(0., 1.)) * .125
      + (glow(-1., -1.) + glow(1., -1.) + glow(-1., 1.) + glow(1., 1.)) * .0625) * bloomIntensity;
    color = ACESFilmicToneMapping(color);

    // Grade: cool what is dark, warm what is lit, then a little contrast and colour.
    float level = luminance(color);
    color += shadows * split * (1. - smoothstep(0., .4, level));
    color *= mix(vec3(1.), highlights, split * smoothstep(.2, .85, level));
    color = pow(max(color, 0.), vec3(1. / 2.2));
    color = max((color - .36) * contrast + .36, 0.);
    color = max(mix(vec3(dot(color, vec3(.2126, .7152, .0722))), color, saturation), 0.);
    color = pow(color, vec3(2.2));
    color *= 1. - vignette.z * smoothstep(vignette.x, vignette.y, distance(vUv, vec2(.5)) * 1.414);

    gl_FragColor = vec4(color, 1.);
    #include <colorspace_fragment>
    // Static grain: tied to the pixel, so a held frame stays exactly as it is.
    gl_FragColor.rgb += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - .5) * grain;
  }`;

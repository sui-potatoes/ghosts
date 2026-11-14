// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import type { SkinRecipe } from "../skin-recipes.ts";

/**
 * A skin painted live on a gun's fittings (scopes, lasers, upgraded clips and
 * stocks): the recipe's paint, pattern, mottle and edge wear evaluated per
 * fragment in the weapon frame, so a fitting continues the pattern of the
 * baked body it sits on at the same scale and orientation. No textures, one
 * draw for every painted fitting on a gun: the shell and frame pieces are
 * merged with a `skinSlot` attribute (0 shell, 1 frame).
 *
 * Mirrors the bake's recipe code (`app/scripts/weapon-skins/skins.py`): same
 * hash, value noise, fbm, patterns and thresholds. Not mirrored: AO grime,
 * stencils and liveries (body only), and the edge mask, which here comes from
 * the screen-space change of the normal (bevels wear, flat faces do not)
 * instead of the baked curvature.
 */

/** Attribute naming a painted vertex's finish: 0 shell, 1 frame. */
export const SKIN_SLOT = "skinSlot";

const KIND = { blotch: 1, digital: 2, splinter: 3, split: 4 } as const;

const linear = (hex: number) => new T.Color(hex);
const srgb = (hex: number) =>
  new T.Vector3((hex >> 16) & 255, (hex >> 8) & 255, hex & 255).divideScalar(
    255,
  );

const NOISE = /* glsl */ `
uniform vec3 skinShell; uniform vec2 skinShellRM;
uniform vec3 skinFrameColor; uniform vec2 skinFrameRM;
uniform int skinKind; uniform int skinToneCount;
uniform vec3 skinTones[4]; uniform vec2 skinToneRM[4];
uniform float skinScale; uniform float skinCell; uniform vec4 skinSplit;
uniform float skinMottle;
uniform vec4 skinWear; uniform vec2 skinWearRM;
varying vec3 vSkinP; varying vec3 vSkinN; varying float vSkinSlot;

float skinHash(ivec3 i, uint seed) {
  uvec3 u = uvec3(i + 1024);
  uint h = (u.x * 0x8da6b343u) ^ (u.y * 0xd8163841u) ^ (u.z * 0xcb1ab31fu) ^ (seed * 0x9e3779b9u);
  h ^= h >> 13u; h *= 0x5bd1e995u; h ^= h >> 15u;
  return float(h & 0xffffu) / 65535.0;
}
float skinNoise(vec3 p, float scale, uint seed) {
  vec3 q = p / scale, b = floor(q), f = q - b;
  f = f * f * (3.0 - 2.0 * f);
  ivec3 i = ivec3(b);
  return mix(
    mix(mix(skinHash(i, seed), skinHash(i + ivec3(1, 0, 0), seed), f.x),
        mix(skinHash(i + ivec3(0, 1, 0), seed), skinHash(i + ivec3(1, 1, 0), seed), f.x), f.y),
    mix(mix(skinHash(i + ivec3(0, 0, 1), seed), skinHash(i + ivec3(1, 0, 1), seed), f.x),
        mix(skinHash(i + ivec3(0, 1, 1), seed), skinHash(i + ivec3(1, 1, 1), seed), f.x), f.y),
    f.z);
}
float skinFbm(vec3 p, float scale, int octaves, uint seed) {
  float s = 0.0, a = 1.0, total = 0.0;
  for (int o = 0; o < 4; o++) {
    if (o >= octaves) break;
    s += a * skinNoise(p, scale / float(1 << o), seed + uint(o));
    total += a; a *= 0.5;
  }
  return s / total;
}
int skinBlotch(vec3 p) {
  float v = skinFbm(p + vec3(0.31, 0.17, 0.05), skinScale, 4, 5u);
  float w = skinFbm(p + vec3(0.11, 0.73, 0.4), skinScale * 0.67, 4, 9u);
  int k = v > 0.53 ? 1 : 0;
  if (skinToneCount > 2 && w > 0.55) k = 2;
  if (skinToneCount > 3 && v < 0.45 && w < 0.5) k = 3;
  return k;
}
int skinPattern(vec3 p) {
  if (skinKind == 1) return skinBlotch(p);
  if (skinKind == 2) return skinBlotch((floor(p / skinCell) + 0.5) * skinCell);
  if (skinKind == 3) {
    ivec3 c = ivec3(floor(vec3(
      dot(p, vec3(0.83, 0.42, 0.37)) / skinScale,
      dot(p, vec3(-0.31, 0.88, -0.36)) / skinScale,
      dot(p, vec3(0.22, -0.35, 0.91)) / (skinScale * 0.7))));
    float h = skinHash(c, 17u);
    if (skinToneCount == 2) return h > 0.6 ? 1 : 0;
    if (skinToneCount == 3) return int(h > 0.5) + int(h > 0.8);
    return int(h > 0.4) + int(h > 0.65) + int(h > 0.85);
  }
  return dot(p, skinSplit.xyz) > skinSplit.w ? 1 : 0;
}
vec3 skinLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}
`;

const PAINT = /* glsl */ `
vec3 skinColor = vSkinSlot < 0.5 ? skinShell : skinFrameColor;
vec2 skinRM = vSkinSlot < 0.5 ? skinShellRM : skinFrameRM;
if (skinKind > 0) {
  int k = skinPattern(vSkinP);
  for (int t = 0; t < 4; t++) if (t == k) { skinColor = skinTones[t]; skinRM = skinToneRM[t]; }
}
float skinV = skinFbm(vSkinP, 0.03, 3, 11u) - 0.5;
skinColor *= 1.0 + skinMottle * skinV;
skinRM.x += 0.6 * skinMottle * skinV;
if (skinWear.a > 0.0) {
  float curvature = length(fwidth(vSkinN)) / max(length(fwidth(vSkinP)), 1e-6);
  float brk = skinFbm(vSkinP, 0.006, 3, 21u);
  float edge = smoothstep(260.0 - 80.0 * skinWear.a, 520.0 - 120.0 * skinWear.a, curvature + 120.0 * (brk - 0.5));
  float e = edge * (0.45 + 0.55 * smoothstep(0.35, 0.65, brk)) * min(1.0, skinWear.a);
  skinColor = mix(skinColor, skinWear.rgb, e);
  skinRM = mix(skinRM, skinWearRM, e);
}
diffuseColor.rgb = skinLinear(clamp(skinColor, 0.0, 1.0));
`;

/** The live paint of `recipe`. `toWeapon` maps the mesh's object space to the
 * Armory weapon frame (identity on the Armory stage; the inverse socket
 * transform for a held gun). */
export function createSkinPaint(
  recipe: SkinRecipe,
  toWeapon: T.Matrix4 = new T.Matrix4(),
  name = "skin-paint",
): T.MeshStandardMaterial {
  const material = new T.MeshStandardMaterial({ name });
  const pattern = recipe.pattern;
  const tones = pattern?.tones ?? [];
  const pad = <V>(list: V[], fill: V) =>
    [0, 1, 2, 3].map((i) => list[i] ?? list[0] ?? fill);
  const uniforms = {
    skinFrame: { value: toWeapon.clone() },
    skinShell: { value: srgb(recipe.shell.color) },
    skinShellRM: {
      value: new T.Vector2(recipe.shell.rough, recipe.shell.metal),
    },
    skinFrameColor: { value: srgb(recipe.frame.color) },
    skinFrameRM: {
      value: new T.Vector2(recipe.frame.rough, recipe.frame.metal),
    },
    skinKind: { value: pattern ? KIND[pattern.kind] : 0 },
    skinToneCount: { value: tones.length },
    skinTones: {
      value: pad(
        tones.map((t) => srgb(t.color)),
        new T.Vector3(),
      ),
    },
    skinToneRM: {
      value: pad(
        tones.map((t) => new T.Vector2(t.rough, t.metal)),
        new T.Vector2(),
      ),
    },
    skinScale: {
      value: pattern && "scale" in pattern ? pattern.scale : 1,
    },
    skinCell: { value: pattern?.kind === "digital" ? pattern.cell : 1 },
    skinSplit: {
      value:
        pattern?.kind === "split"
          ? new T.Vector4(...pattern.normal, pattern.offset)
          : new T.Vector4(),
    },
    skinMottle: { value: recipe.mottle },
    skinWear: {
      value: recipe.wear
        ? new T.Vector4(
            ...srgb(recipe.wear.color).toArray(),
            recipe.wear.amount,
          )
        : new T.Vector4(),
    },
    skinWearRM: {
      value: new T.Vector2(recipe.wear?.rough ?? 1, recipe.wear?.metal ?? 0),
    },
  };
  material.userData.skinUniforms = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute float ${SKIN_SLOT};
uniform mat4 skinFrame;
varying vec3 vSkinP; varying vec3 vSkinN; varying float vSkinSlot;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vSkinP = (skinFrame * vec4(position, 1.0)).xyz;
vSkinN = normalize(mat3(skinFrame) * objectNormal);
vSkinSlot = ${SKIN_SLOT};`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${NOISE}`)
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>\n${PAINT}`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        "float roughnessFactor = clamp(skinRM.x, 0.04, 1.0);",
      )
      .replace(
        "#include <metalnessmap_fragment>",
        "float metalnessFactor = clamp(skinRM.y, 0.0, 1.0);",
      );
  };
  material.customProgramCacheKey = () => "ghosts-skin-paint-1";
  // Kept for tools that read the material's nominal colour (thumbnails, tests).
  material.color.copy(linear(recipe.shell.color));
  return material;
}

// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";

/**
 * Damage is shaded on the intact triangles, never on an offset bounding-box
 * plane. Each prop owns its material clones; cached assets stay undamaged.
 * PropAssets bakes part transforms into its merged, prop-local vertices.
 */
export class SurfaceDamage {
  private readonly amount = { value: 0 };
  private readonly materials = new Map<T.MeshStandardMaterial, T.MeshStandardMaterial>();
  private readonly originals: { mesh: T.Mesh; material: T.Material | T.Material[] }[] = [];

  constructor(intact: T.Group, bounds: T.Box3) {
    const minimum = { value: bounds.min.clone() };
    const size = bounds.getSize(new T.Vector3());
    const inverseSize = { value: new T.Vector3(
      1 / Math.max(size.x, 0.01), 1 / Math.max(size.y, 0.01), 1 / Math.max(size.z, 0.01),
    ) };
    const damaged = (source: T.Material) => {
      if (!(source instanceof T.MeshStandardMaterial)) return source;
      const cached = this.materials.get(source);
      if (cached) return cached;
      const material = source.clone();
      material.name = `${source.name || "Prop finish"} / surface damage`;
      material.customProgramCacheKey = () => "prop-surface-damage-v1";
      material.onBeforeCompile = (shader) => {
        shader.uniforms.damageAmount = this.amount;
        shader.uniforms.damageMinimum = minimum;
        shader.uniforms.damageInverseSize = inverseSize;
        shader.vertexShader = `
          uniform vec3 damageMinimum;
          uniform vec3 damageInverseSize;
          varying vec3 damagePosition;
          varying vec3 damageNormal;
        ` + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", `
          #include <begin_vertex>
          damagePosition = (transformed - damageMinimum) * damageInverseSize;
          damageNormal = normal;
        `);
        shader.fragmentShader = `
          uniform float damageAmount;
          varying vec3 damagePosition;
          varying vec3 damageNormal;
          float damageSegment(vec2 p, vec2 a, vec2 b) {
            vec2 edge = b - a;
            return length(p - a - edge * clamp(dot(p-a, edge) / dot(edge, edge), 0., 1.));
          }
          float damageCrack(vec2 p) {
            float d = damageSegment(p, vec2(.12,.08), vec2(.38,.38));
            d = min(d, damageSegment(p, vec2(.38,.38), vec2(.32,.53)));
            d = min(d, damageSegment(p, vec2(.32,.53), vec2(.56,.68)));
            d = min(d, damageSegment(p, vec2(.56,.68), vec2(.65,.96)));
            d = min(d, damageSegment(p, vec2(.38,.38), vec2(.69,.27)));
            d = min(d, damageSegment(p, vec2(.69,.27), vec2(.84,.34)));
            d = min(d, damageSegment(p, vec2(.56,.68), vec2(.22,.77)));
            float width = mix(.0015, .005, damageAmount);
            float aa = max(fwidth(d) * .65, .0005);
            return 1. - smoothstep(width-aa, width+aa, d);
          }
        ` + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", `
          #include <color_fragment>
          // Choose a surface projection in prop space. Rotation and camera
          // movement cannot detach it; openings have no fragments to shade.
          vec3 n = abs(normalize(damageNormal));
          vec2 surface = n.z >= max(n.x, n.y) ? damagePosition.xy :
            (n.x >= n.y ? damagePosition.zy : damagePosition.xz);
          float crack = damageCrack(surface) * smoothstep(0., .18, damageAmount);
          diffuseColor.rgb *= mix(1., .16, crack);
        `);
      };
      this.materials.set(source, material);
      return material;
    };
    intact.traverse((object) => {
      if (!(object instanceof T.Mesh)) return;
      this.originals.push({ mesh: object, material: object.material });
      object.material = Array.isArray(object.material) ? object.material.map(damaged) : damaged(object.material);
    });
  }

  setAmount(amount: number) {
    this.amount.value = T.MathUtils.clamp(amount, 0, 1);
  }

  dispose() {
    for (const { mesh, material } of this.originals) mesh.material = material;
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
    this.originals.length = 0;
  }
}

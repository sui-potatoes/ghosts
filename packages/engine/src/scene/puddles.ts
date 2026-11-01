// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";

/** Static rain shelter, independent of camera cutaways. Roof and awning bounds include recessed entrances. */
export function createPuddleExposure(buildings: readonly T.Object3D[], reach: number) {
  const size = 512, span = reach * 2, feather = 0.45;
  const data = new Uint8Array(size * size).fill(255);
  for (const building of buildings) {
    building.updateWorldMatrix(true, true);
    const bounds = new T.Box3().setFromObject(building);
    if (bounds.isEmpty()) continue;
    const pixel = (metres: number) => (metres + reach) / span * size;
    const minX = Math.max(0, Math.floor(pixel(bounds.min.x - feather)));
    const maxX = Math.min(size - 1, Math.ceil(pixel(bounds.max.x + feather)));
    const minZ = Math.max(0, Math.floor(pixel(bounds.min.z - feather)));
    const maxZ = Math.min(size - 1, Math.ceil(pixel(bounds.max.z + feather)));
    for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) {
      const worldX = (x + 0.5) / size * span - reach;
      const worldZ = (z + 0.5) / size * span - reach;
      const dx = Math.max(bounds.min.x - worldX, 0, worldX - bounds.max.x);
      const dz = Math.max(bounds.min.z - worldZ, 0, worldZ - bounds.max.z);
      // Leave a small dry edge so bilinear sampling cannot leak water under a wall.
      const exposed = T.MathUtils.smoothstep(Math.hypot(dx, dz), span / size, feather);
      const i = z * size + x;
      data[i] = Math.min(data[i], Math.round(exposed * 255));
    }
  }
  const texture = new T.DataTexture(data, size, size, T.RedFormat);
  texture.minFilter = texture.magFilter = T.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return { texture, transform: new T.Vector4(-reach, -reach, 1 / span, 1 / span) };
}

/** World-space noise modulates reflectance without tiling a puddle across every paving stone. */
export function addPuddles(material: T.MeshStandardMaterial, exposure: ReturnType<typeof createPuddleExposure>) {
  material.userData.puddleSurface = true;
  material.customProgramCacheKey = () => "street-puddles-v2";
  material.onBeforeCompile = (shader) => {
    shader.uniforms.puddleExposure = { value: exposure.texture };
    shader.uniforms.puddleTransform = { value: exposure.transform };
    shader.vertexShader = `varying vec3 puddlePosition; varying float puddleUp;\n` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", `
      #include <begin_vertex>
      puddlePosition = (modelMatrix * vec4(transformed, 1.)).xyz;
      puddleUp = (modelMatrix * vec4(objectNormal, 0.)).y;
    `);
    shader.fragmentShader = `
      uniform sampler2D puddleExposure;
      uniform vec4 puddleTransform;
      varying vec3 puddlePosition;
      varying float puddleUp;
      float puddleHash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float puddleNoise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
        return mix(mix(puddleHash(i), puddleHash(i + vec2(1,0)), f.x),
          mix(puddleHash(i + vec2(0,1)), puddleHash(i + vec2(1,1)), f.x), f.y);
      }
    ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace("#include <roughnessmap_fragment>", `
      #include <roughnessmap_fragment>
      vec2 p = puddlePosition.xz * .7;
      float noise = puddleNoise(p) * .65 + puddleNoise(p * 2.7 + 4.2) * .25 + puddleNoise(p * 7.1) * .10;
      vec2 shelterUv = (puddlePosition.xz - puddleTransform.xy) * puddleTransform.zw;
      float exposed = texture2D(puddleExposure, clamp(shelterUv, 0., 1.)).r;
      float wet = smoothstep(.53, .65, noise) * smoothstep(.8, .98, puddleUp) * exposed;
      roughnessFactor = mix(roughnessFactor, .075, wet);
      diffuseColor.rgb *= mix(1., .66, wet);
    `);
    shader.fragmentShader = shader.fragmentShader.replace("#include <normal_fragment_maps>", `
      #include <normal_fragment_maps>
      // Water fills the asphalt grain instead of inheriting every dry bump.
      normal = normalize(mix(normal, nonPerturbedNormal, wet * .95));
    `);
  };
  return material;
}

/** A static reflection probe captures the district's sky and facades once per lighting change. */
export class StreetReflections {
  private readonly cube = new T.WebGLCubeRenderTarget(128, { type: T.HalfFloatType });
  private readonly camera = new T.CubeCamera(0.2, 180, this.cube);
  private environment?: T.WebGLRenderTarget;

  capture(renderer: T.WebGLRenderer, scene: T.Scene) {
    const surfaces = new Set<T.MeshStandardMaterial>();
    scene.traverse((object) => {
      if (!(object instanceof T.Mesh)) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material])
        if (material instanceof T.MeshStandardMaterial && material.userData.puddleSurface) surfaces.add(material);
    });
    const previous = [...surfaces].map((material) => ({ material, environment: material.envMap }));
    // Capture without feeding the previous probe back into the next one.
    for (const material of surfaces) material.envMap = null;
    const generator = new T.PMREMGenerator(renderer);
    this.camera.position.set(0, 2.5, 0);
    try {
      this.camera.update(renderer, scene);
      const next = generator.fromCubemap(this.cube.texture);
      // The probe is a ground reflection, not a new light source for the
      // buildings, characters and props. Preserve the authored scene lighting.
      for (const material of surfaces) {
        material.envMap = next.texture;
        material.envMapIntensity = .35;
        material.needsUpdate = true;
      }
      this.environment?.dispose();
      this.environment = next;
    } catch (error) {
      for (const { material, environment } of previous) material.envMap = environment;
      throw error;
    } finally {
      generator.dispose();
    }
  }

  dispose() { this.cube.dispose(); this.environment?.dispose(); }
}

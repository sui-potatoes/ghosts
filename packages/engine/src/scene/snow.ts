// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import { propRandom } from "../environment.ts";

const WIDTH = 65, HEIGHT = 23, DEPTH = 55;
export const SNOW_PARTICLES = { battery: 900, smooth: 2400 } as const;

/** Static seed buffers; the GPU moves every flake using one time uniform. */
export class Snow {
  readonly mesh: T.Points<T.BufferGeometry, T.ShaderMaterial>;

  constructor() {
    const count = SNOW_PARTICLES.smooth, random = propRandom(0x534e4f57);
    const positions = new Float32Array(count * 3), flakes = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      positions.set([(random() - 0.5) * WIDTH, random() * HEIGHT, (random() - 0.5) * DEPTH], i * 3);
      // Fall speed, flutter phase, diameter in metres, opacity.
      flakes.set([0.65 + random() * 0.8, random() * Math.PI * 2, 0.055 + random() * 0.065, 0.45 + random() * 0.4], i * 4);
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute("position", new T.BufferAttribute(positions, 3));
    geometry.setAttribute("flake", new T.BufferAttribute(flakes, 4));
    geometry.boundingBox = new T.Box3(new T.Vector3(-WIDTH / 2, 0, -DEPTH / 2),
      new T.Vector3(WIDTH / 2, HEIGHT + 0.2, DEPTH / 2));
    geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new T.Sphere());
    const material = new T.ShaderMaterial({
      uniforms: {
        ...T.UniformsUtils.clone(T.UniformsLib.fog),
        time: { value: 0 },
        viewportHeight: { value: 1 },
      },
      fog: true, transparent: true, depthWrite: false,
      vertexShader: `
        uniform float time;
        uniform float viewportHeight;
        attribute vec4 flake;
        varying float opacity;
        #include <fog_pars_vertex>
        void main() {
          vec3 p = position;
          float phase = time * 0.7 + flake.y;
          p.x = mod(p.x + time * 0.38 + sin(phase) * 0.6 + ${(WIDTH / 2).toFixed(1)}, ${WIDTH}.) - ${(WIDTH / 2).toFixed(1)};
          p.z = mod(p.z + cos(phase * 0.8) * 0.45 + ${(DEPTH / 2).toFixed(1)}, ${DEPTH}.) - ${(DEPTH / 2).toFixed(1)};
          p.y = mod(p.y - time * flake.x, ${HEIGHT}.) + 0.2;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = clamp(flake.z * viewportHeight * 0.5 * projectionMatrix[1][1] / max(0.1, -mvPosition.z), 1.2, 9.);
          opacity = flake.w * smoothstep(0.2, 0.8, p.y);
          #include <fog_vertex>
        }`,
      fragmentShader: `
        varying float opacity;
        #include <fog_pars_fragment>
        void main() {
          float radius = length(gl_PointCoord - 0.5) * 2.;
          float alpha = (1. - smoothstep(0.35, 1., radius)) * opacity;
          if (alpha < 0.025) discard;
          gl_FragColor = vec4(0.85, 0.92, 1., alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    this.mesh = new T.Points(geometry, material);
    this.mesh.name = "GPU snow";
    this.setBatterySaver(true);
  }

  setBatterySaver(enabled: boolean) {
    this.mesh.geometry.setDrawRange(0, enabled ? SNOW_PARTICLES.battery : SNOW_PARTICLES.smooth);
  }

  setViewportHeight(pixels: number) {
    this.mesh.material.uniforms.viewportHeight.value = Math.max(1, pixels);
  }

  update(dt: number) {
    if (this.mesh.visible) this.mesh.material.uniforms.time.value += dt;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

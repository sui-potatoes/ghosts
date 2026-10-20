// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from 'three';

/** Six depth-tested mist layers, one draw call and one shared 128px texture. */
export function perimeterMist() {
  const size = 128;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const a = x / size * Math.PI * 2, b = y / size * Math.PI * 2;
    const v = 128 + 38 * Math.sin(a + 2 * Math.cos(b))
      + 28 * Math.cos(b * 2 - a) + 18 * Math.sin(a * 3 + b * 4);
    const i = (y * size + x) * 4;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = v;
    pixels[i + 3] = 255;
  }
  const texture = new T.DataTexture(pixels, size, size);
  texture.wrapS = texture.wrapT = T.RepeatWrapping;
  texture.magFilter = texture.minFilter = T.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  const material = new T.ShaderMaterial({
    transparent: true, depthWrite: false, side: T.DoubleSide,
    uniforms: { mist: { value: texture }, time: { value: 0 }, tint: { value: new T.Color('#9aa8c0') } },
    vertexShader: `
      varying vec3 world;
      void main() {
        vec4 p = modelMatrix * instanceMatrix * vec4(position, 1.0);
        world = p.xyz;
        gl_Position = projectionMatrix * viewMatrix * p;
      }`,
    fragmentShader: `
      uniform sampler2D mist;
      uniform float time;
      uniform vec3 tint;
      varying vec3 world;
      void main() {
        float radius = max(abs(world.x + .675) * .8, abs(world.z + .675));
        float edge = smoothstep(6.0, 12.5, radius) * (1.0 - smoothstep(19.0, 26.0, radius));
        vec2 uv = world.xz * .042 + vec2(time * .003, time * -.001);
        float cloud = texture2D(mist, uv + world.y * .09).r;
        cloud *= texture2D(mist, uv * 1.7 - world.y * .07).r;
        float alpha = edge * cloud * .14;
        gl_FragColor = vec4(tint, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new T.InstancedMesh(new T.PlaneGeometry(64, 56), material, 6);
  const transform = new T.Object3D();
  transform.rotation.x = -Math.PI / 2;
  for (let i = 0; i < 6; i++) {
    transform.position.set(0, .22 + i * .38, 0);
    transform.updateMatrix();
    mesh.setMatrixAt(i, transform.matrix);
  }
  mesh.name = 'Low perimeter mist';
  mesh.frustumCulled = false;
  return { mesh, update: (time: number) => { material.uniforms.time.value = time; }, dispose: () => texture.dispose() };
}

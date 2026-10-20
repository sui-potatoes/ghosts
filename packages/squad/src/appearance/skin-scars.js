// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { Vector4 } from "three";
const styles = ["none", "fine", "slash", "paired", "stitched"];
// Rest coordinates make markings follow morphs and native skinning with no decal mesh.
export function installScars(mesh, top) {
    const material = mesh.userData.original,
        previous = material.onBeforeCompile;
    const u = { scarConfig: { value: new Vector4() }, scarPlacement: { value: new Vector4() } };
    mesh.userData.scars = u;
    material.onBeforeCompile = (shader) => {
        previous(shader);
        Object.assign(shader.uniforms, u);
        shader.fragmentShader =
            `uniform vec4 scarConfig;uniform vec4 scarPlacement;
 float scarLine(vec2 p,float offset){
  float along=clamp(p.y / scarConfig.z,-1.0,1.0);
  float path=offset+0.00065*sin(along*3.3)+0.00025*sin(along*11.0);
  float taper=sqrt(max(0.0,1.0-along*along));
  return length(vec2((p.x-path)/max(0.0002,scarConfig.w*taper),max(0.0,abs(p.y)-scarConfig.z)/0.001));
 }
 ` + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace(
            "#include <color_fragment>",
            `#include <color_fragment>
 float scarCoverage=0.0;
 if(scarConfig.x>0.5 && scarConfig.y>0.0){
 vec2 scarP=vBlushRest.xy-scarPlacement.xy;
 scarP=mat2(cos(scarPlacement.z),-sin(scarPlacement.z),sin(scarPlacement.z),cos(scarPlacement.z))*scarP;
 float scarD=scarLine(scarP,0.0);
 if(scarConfig.x>2.5&&scarConfig.x<3.5)scarD=min(scarD,scarLine(scarP,0.004));
 float scarEdge=1.0-smoothstep(0.6,2.6,scarD);
 float scarCore=1.0-smoothstep(0.25,1.0,scarD);
 if(scarConfig.x>3.5){
  float ticks=(1.0-smoothstep(0.0004,0.00095,abs(mod(scarP.y+0.002,0.004)-0.002))) * (1.0-smoothstep(0.002,0.004,abs(scarP.x))) * (1.0-smoothstep(scarConfig.z*.7,scarConfig.z,abs(scarP.y)));
  scarEdge=max(scarEdge,ticks*.6);scarCore=max(scarCore,ticks*.4);
 }
 float scarMask=scarConfig.y*step(0.5,scarConfig.x)*smoothstep(0.075,0.105,vBlushRest.z);
 // Healed tissue keeps the underlying skin tone; no black ink or opaque stickers.
 diffuseColor.rgb*=1.0-vec3(0.04,0.17,0.14)*scarEdge*scarMask;
 diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*.94+vec3(.035,.023,.019),scarCore*scarMask*.65);
 scarCoverage=scarEdge*scarMask;
 }
 `,
        );
        shader.fragmentShader = shader.fragmentShader.replace(
            "#include <roughnessmap_fragment>",
            `#include <roughnessmap_fragment>\n roughnessFactor=mix(roughnessFactor,max(roughnessFactor,0.95),scarCoverage);`,
        );
    };
    material.customProgramCacheKey = () => "mpfb-skin-scars-v2";
    material.needsUpdate = true;
    mesh.userData.scarTop = top;
}
export function updateScars(mesh, s) {
    const u = mesh.userData.scars;
    if (!u) return;
    const top = mesh.userData.scarTop;
    const places = {
        cheekLeft: [0.046, top - 0.15, -0.45],
        cheekRight: [-0.046, top - 0.15, 0.45],
        temple: [0.061, top - 0.101, 0.2],
        bridge: [0, top - 0.128, 1.28],
    };
    const p = places[s.scarPlace] ?? places.cheekLeft;
    u.scarPlacement.value.set(...p, 0);
    u.scarConfig.value.set(
        Math.max(0, styles.indexOf(s.scar)),
        s.scarAmount ?? 0.6,
        s.scar === "fine" ? 0.011 : s.scarPlace === "bridge" ? 0.013 : 0.019,
        s.scar === "fine" ? 0.00055 : 0.00085,
    );
}

import { BufferAttribute, Color, Vector4 } from "three";

// Rest-space coordinates stay attached to the skin through every native morph.
// Blush modulates the existing albedo: pores and skin tone remain visible.
export function installBlush(mesh, top) {
    const geometry = mesh.geometry,
        material = mesh.userData.original;
    geometry.setAttribute("blushRest", new BufferAttribute(mesh.userData.base.slice(), 3));
    const uniforms = {
        blushColor: { value: new Color() },
        blushStrength: { value: 0 },
        blushShape: { value: new Vector4() },
        blushTop: { value: top },
    };
    material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader =
            "attribute vec3 blushRest;\nvarying vec3 vBlushRest;\n" + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace(
            "#include <begin_vertex>",
            "#include <begin_vertex>\nvBlushRest = blushRest;",
        );
        shader.fragmentShader =
            "varying vec3 vBlushRest;\nuniform vec3 blushColor;\nuniform float blushStrength;\nuniform float blushTop;\nuniform vec4 blushShape;\n" +
            shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace(
            "#include <color_fragment>",
            `#include <color_fragment>
   vec2 cheek = vec2(abs(vBlushRest.x) - blushShape.x, vBlushRest.y - (blushTop - blushShape.y));
   cheek.y -= cheek.x * 0.22;
   float radius2 = dot(cheek / blushShape.zw, cheek / blushShape.zw);
   float mask = exp(-2.5 * radius2) * (1.0 - smoothstep(1.1, 1.7, radius2));
   mask *= smoothstep(0.065, 0.105, vBlushRest.z);
   float luminance = max(dot(blushColor, vec3(0.2126, 0.7152, 0.0722)), 0.025);
   vec3 pigment = clamp(0.5 + 0.5 * blushColor / luminance, vec3(0.55), vec3(1.7));
   diffuseColor.rgb *= mix(vec3(1.0), pigment, mask * blushStrength * 0.65);
  `,
        );
    };
    material.customProgramCacheKey = () => "mpfb-skin-blush-v1";
    material.needsUpdate = true;
    mesh.userData.blush = uniforms;
}
export function updateBlush(mesh, state) {
    const u = mesh.userData.blush;
    if (!u) return;
    u.blushColor.value.set(state.blushColor);
    u.blushStrength.value = state.blushAmount;
    const high = state.blushPlacement === "high",
        size = 0.8 + state.blushSpread * 0.6;
    u.blushShape.value.set(high ? 0.054 : 0.043, high ? 0.124 : 0.144, 0.029 * size, 0.018 * size);
}

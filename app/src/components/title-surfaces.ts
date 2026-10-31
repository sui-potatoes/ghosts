// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT
import * as THREE from "three";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";

type Surface = "concrete" | "brick" | "asphalt";
type Maps = { color: THREE.Texture; normal: THREE.Texture; rough: THREE.Texture };

/** The game's existing surface-only PBR assets, owned by this scene. */
export function createTitleSurfaces(renderer: THREE.WebGLRenderer, changed: () => void) {
    const loader = new KTX2Loader()
        .setTranscoderPath("/demo-assets/basis/")
        .setWorkerLimit(1)
        .detectSupport(renderer);
    const textures: THREE.Texture[] = [];
    let disposed = false;
    const pending = new Map<Surface, Promise<Maps>>();
    function load(kind: Surface) {
        let result = pending.get(kind);
        if (!result) {
            result = Promise.all(
                ["color", "normal", "rough"].map(async (type) => {
                    const texture = await loader.loadAsync(
                        `/demo-assets/textures/district/${kind}-${type}.ktx2`,
                    );
                    texture.colorSpace =
                        type === "color" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
                    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
                    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
                    if (disposed) texture.dispose();
                    else textures.push(texture);
                    return texture;
                }),
            ).then(([color, normal, rough]) => ({ color, normal, rough }));
            pending.set(kind, result);
        }
        return result;
    }
    function applyMaps(kind: Surface, apply: (maps: Maps) => void) {
        void load(kind)
            .then((maps) => {
                if (disposed) return;
                apply(maps);
                changed();
            })
            .catch((error) => {
                if (!disposed) console.warn("Title surface uses procedural fallback", error);
            });
    }
    return {
        applyMaps,
        ready: () => Promise.allSettled([...pending.values()]),
        bind(material: THREE.MeshStandardMaterial, kind: Surface) {
            applyMaps(kind, (maps) => {
                material.map = maps.color;
                material.normalMap = maps.normal;
                material.roughnessMap = maps.rough;
                material.normalScale.set(0.3, 0.3);
                material.needsUpdate = true;
            });
        },
        dispose() {
            disposed = true;
            textures.forEach((texture) => texture.dispose());
            loader.dispose();
        },
    };
}
export type TitleSurfaces = ReturnType<typeof createTitleSurfaces>;

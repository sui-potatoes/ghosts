// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as THREE from "three";
import facadeAtlas from "../assets/title-skyline.webp";

/** Distant city plate. Foreground depth and occlusion belong exclusively to
 * the modeled street, so background proxy geometry cannot cut through bridges. */
const halfHeight = Math.tan(THREE.MathUtils.degToRad(23));
const halfWidth = (halfHeight * 1672) / 941;
export function referencePoint(x: number, y: number, distance: number) {
    return new THREE.Vector3(
        (x / 1672 - 0.758) * 2 * halfWidth * distance,
        (0.753 - y / 941) * 2 * halfHeight * distance + 1.65,
        2 - distance,
    );
}

export function createTitleSkyline(scene: THREE.Scene, changed: () => void) {
    const geometries: THREE.BufferGeometry[] = [];
    let disposed = false;
    let resolveReady: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
        resolveReady = resolve;
    });
    const atlas = new THREE.TextureLoader().load(
        facadeAtlas,
        () => {
            resolveReady();
            if (!disposed) changed();
        },
        undefined,
        () => resolveReady(),
    );
    atlas.colorSpace = THREE.SRGBColorSpace;
    atlas.anisotropy = 8;
    // Project from the fixed reference camera, including its off-centre framing.
    const facade = new THREE.ShaderMaterial({
        uniforms: { image: { value: atlas } },
        vertexShader: `varying vec3 world;void main(){world=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(world,1.);}`,
        fragmentShader: `uniform sampler2D image;varying vec3 world;
        void main(){float d=2.-world.z;vec2 uv=vec2(.758+world.x/(${2 * halfWidth}*d),.247+(world.y-1.65)/(${2 * halfHeight}*d));
            // Clean distant-city plate: foreground architecture, bridges and
            // lamps were removed from the asset. Geometry supplies occlusion;
            // no screen-space cutouts or cloned sky rectangles are needed.
            uv.x -= 52. / 1672.;
            if(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.))))discard;
            gl_FragColor=texture2D(image,uv);
            #include <colorspace_fragment>
        }`,
        side: THREE.DoubleSide,
    });
    const root = new THREE.Group();
    root.name = "Distant city background";
    scene.add(root);
    // The clean city plate sits behind all modeled street geometry.
    const backdropGeometry = new THREE.PlaneGeometry(2 * halfWidth * 480, 2 * halfHeight * 480);
    backdropGeometry.translate(...referencePoint(836, 470.5, 480).toArray());
    geometries.push(backdropGeometry);
    const backdrop = new THREE.Mesh(backdropGeometry, facade);
    backdrop.name = "Photographic distant city and sky";
    root.add(backdrop);
    return {
        ready,
        dispose() {
            disposed = true;
            root.removeFromParent();
            geometries.forEach((g) => g.dispose());
            facade.dispose();
            atlas.dispose();
        },
    };
}

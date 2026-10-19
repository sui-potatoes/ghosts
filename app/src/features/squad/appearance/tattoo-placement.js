import * as T from "three";
import { frontSurface } from "./brow-shape.js";
import { DecalGeometry } from "three/addons/geometries/DecalGeometry.js";

// Locate cheek marks relative to the morphed eyes, rather than a fixed skull-top offset.
// Both portrait and combat use the same projection and skin clearance.
export function tattooGeometry(state, skin, eyes) {
    const body = new T.Mesh(skin, new T.MeshBasicMaterial({ side: T.FrontSide }));
    body.updateMatrixWorld(true);
    const top = new T.Box3().setFromObject(body).max.y,
        side = state.tattooPlace === "cheekRight" ? -1 : 1;
    let x = state.tattooPlace === "forehead" ? 0 : 0.065,
        y = top - (state.tattooPlace === "forehead" ? 0.072 : 0.114);
    if (state.tattooPlace.startsWith("cheek")) {
        const p = eyes.attributes.position,
            b = new T.Box3();
        for (let i = 0; i < p.count; i++)
            if (Math.sign(p.getX(i)) === side)
                b.expandByPoint(new T.Vector3().fromBufferAttribute(p, i));
        const eye = b.getCenter(new T.Vector3());
        x = Math.abs(eye.x) + 0.005;
        y = eye.y - 0.031;
    }
    const hit = new T.Raycaster(
        new T.Vector3(x * side, y, 0.5),
        new T.Vector3(0, 0, -1),
    ).intersectObject(body, false)[0];
    body.material.dispose();
    if (!hit) return null;
    const normal = (hit.normal ?? hit.face.normal).clone().normalize(),
        q = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 0, 1), normal);
    const projected = new DecalGeometry(
        body,
        hit.point,
        new T.Euler().setFromQuaternion(q),
        new T.Vector3(0.029, 0.035, 0.024),
    );
    const surface = frontSurface(skin.attributes.position.array, skin.index.array),
        source = projected.attributes.position,
        keep = [];
    // The projection volume can reach inner mouth/eye surfaces. Keep only frontmost skin.
    for (let i = 0; i < source.count; i += 3) {
        let x = 0,
            y = 0,
            z = 0;
        for (let j = 0; j < 3; j++) {
            x += source.getX(i + j) / 3;
            y += source.getY(i + j) / 3;
            z += source.getZ(i + j) / 3;
        }
        const front = surface(x, y);
        if (front !== null && z >= front - 0.0001) keep.push(i, i + 1, i + 2);
    }
    const g = new T.BufferGeometry();
    for (const [name, attr] of Object.entries(projected.attributes)) {
        const values = new Float32Array(keep.length * attr.itemSize);
        for (let i = 0; i < keep.length; i++)
            for (let j = 0; j < attr.itemSize; j++)
                values[i * attr.itemSize + j] = attr.getComponent(keep[i], j);
        g.setAttribute(name, new T.BufferAttribute(values, attr.itemSize));
    }
    projected.dispose();
    // Small real clearance avoids depth fighting on the skin, including grazing views.
    const p = g.attributes.position,
        n = g.attributes.normal;
    for (let i = 0; i < p.count; i++)
        p.setXYZ(
            i,
            p.getX(i) + n.getX(i) * 0.00018,
            p.getY(i) + n.getY(i) * 0.00018,
            p.getZ(i) + n.getZ(i) * 0.00018,
        );
    g.computeBoundingSphere();
    g.userData.anchor = hit.point.toArray();
    return g;
}

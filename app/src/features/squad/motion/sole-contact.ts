import * as T from "three";
const point = new T.Vector3();
/** A small, cached sampling of the native sole surface; used for boot contact and crossfades. */
export function soleProbeIndices(geometry: T.BufferGeometry) {
    const p = geometry.attributes.position,
        indices = new Set<number>();
    // Include the upper and side surfaces too: a bent kneeling foot can contact
    // with its toes or instep. Sole-only samples miss those during crossfades.
    for (const side of [-1, 1])
        for (const front of [false, true]) {
            const candidates = [];
            for (let i = 0; i < p.count; i++)
                if (
                    p.getY(i) < 0.13 &&
                    Math.sign(p.getX(i)) === side &&
                    p.getZ(i) > 0.085 === front
                )
                    candidates.push(i);
            for (let d = 0; d < 48; d++) {
                const y = 1 - (2 * d) / 47,
                    r = Math.sqrt(1 - y * y),
                    angle = d * 2.39996323,
                    x = Math.cos(angle) * r,
                    z = Math.sin(angle) * r;
                let best = -1,
                    min = Infinity;
                for (const i of candidates) {
                    const value = x * p.getX(i) + y * p.getY(i) + z * p.getZ(i);
                    if (value < min) {
                        min = value;
                        best = i;
                    }
                }
                if (best >= 0) indices.add(best);
            }
        }
    return [...indices];
}
/** Returns world-space sole height. Uses the same skinning as the rendered body. */
function meshSoleMinimum(mesh: T.SkinnedMesh) {
    const indices = (mesh.userData.soleProbes ??= soleProbeIndices(mesh.geometry));
    // Refresh only the foot chains instead of traversing every mesh and finger.
    for (const bone of mesh.skeleton.bones)
        if (/(?:Leg|Foot|ToeBase)$/.test(bone.name)) bone.updateWorldMatrix(true, false);
    mesh.updateWorldMatrix(true, false);
    mesh.updateMatrixWorld(true);
    let minimum = Infinity;
    for (const i of indices) {
        point.fromBufferAttribute(mesh.geometry.attributes.position, i);
        mesh.applyBoneTransform(i, point).applyMatrix4(mesh.matrixWorld);
        minimum = Math.min(minimum, point.y);
    }
    return minimum;
}

/** Contact follows boot outsoles when the field kit is equipped. */
export function soleMinimum(body: T.SkinnedMesh) {
    const boots = (body.parent?.children ?? []).filter(
        (mesh): mesh is T.SkinnedMesh =>
            mesh instanceof T.SkinnedMesh && mesh.userData.nativePart === "field-kit",
    );
    return Math.min(...(boots.length ? boots : [body]).map(meshSoleMinimum));
}

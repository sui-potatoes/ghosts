import { test } from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { posedSurface, weaponEdges } from "./gear-collision.ts";
function cube() {
    const root = new T.Group(),
        bone = new T.Bone();
    bone.name = "mixamorigSpine2";
    root.add(bone);
    const geometry = new T.BoxGeometry(1, 1, 1),
        count = geometry.attributes.position.count;
    geometry.setAttribute("skinIndex", new T.Uint16BufferAttribute(new Uint16Array(count * 4), 4));
    const weights = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) weights[i * 4] = 1;
    geometry.setAttribute("skinWeight", new T.Float32BufferAttribute(weights, 4));
    const mesh = new T.SkinnedMesh(geometry, new T.MeshBasicMaterial());
    root.add(mesh);
    root.updateMatrixWorld(true);
    mesh.bind(new T.Skeleton([bone]), new T.Matrix4());
    return { root, bone, meshes: [mesh] };
}
test("mesh audit detects crossings and fully enclosed objects, then refits animated skin", () => {
    const { root, bone, meshes } = cube();
    let surface = posedSurface(meshes);
    assert.ok(surface.segment(new T.Vector3(-1, 0.1, 0.1), new T.Vector3(1, 0.1, 0.1)).length >= 2);
    assert.ok(surface(new T.Vector3(0, 0.1, 0.1))!.depth > 0.3);
    assert.equal(surface(new T.Vector3(2, 0, 0)), null);
    bone.position.x = 3;
    root.updateMatrixWorld(true);
    surface = posedSurface(meshes);
    assert.equal(surface(new T.Vector3(0, 0.1, 0.1)), null);
    assert.ok(surface(new T.Vector3(3, 0.1, 0.1)));
});
test("weapon audit supports indexed geometry and owns each returned edge endpoint", () => {
    const cube = new T.Mesh(new T.BoxGeometry(1, 1, 1)),
        edges = weaponEdges(cube);
    assert.ok(edges.length >= 12);
    const originals = edges.map((e) => e.map((v) => v.clone()));
    edges[0][0].addScalar(100);
    for (let i = 1; i < edges.length; i++)
        assert.ok(edges[i][0].equals(originals[i][0]) && edges[i][1].equals(originals[i][1]));
});

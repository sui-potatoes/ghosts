// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { CELL, STREET, districtBuildings, footprint, koraPlan, surfaceHeight } from './district-plan.ts';
import { TacticalMap } from './map.ts';
import { blackRain } from './scenario.ts';
import { buildRelay } from './scene/props.ts';
test('building geometry shares exact collision-cell footprints and leaves connected streets', () => {
  for(const b of districtBuildings) {
    const f=footprint(b);
    assert.equal(f.w,b.w*CELL);
    assert.ok(f.minX >= STREET.avenueHalf || f.maxX <= -STREET.avenueHalf);
    assert.ok(f.minZ >= STREET.crossHalf || f.maxZ <= -STREET.crossHalf);
    for(let x=b.x-Math.floor(b.w/2);x<b.x-Math.floor(b.w/2)+b.w;x++)
      for(let z=b.z-Math.floor(b.d/2);z<b.z-Math.floor(b.d/2)+b.d;z++) {
        assert.ok(x*CELL>f.minX && x*CELL<f.maxX);
        assert.ok(z*CELL>f.minZ && z*CELL<f.maxZ);
      }
  }
});
test('all original squad spawns and vault landing cells remain clear of buildings', () => {
  for(const [x,z] of [[-3,4],[-1,5],[1,4],[-5,3],[2,-3],[5,-2],[-3,-4],[-3,3],[-3,1]])
    for(const b of districtBuildings) {
      const f=footprint(b);
      assert.ok(!(x*CELL>f.minX && x*CELL<f.maxX && z*CELL>f.minZ && z*CELL<f.maxZ));
    }
});
test('sidewalk heights and paired curb ramps meet the road without a step',()=>{
  assert.equal(surfaceHeight(0,12),0);assert.equal(surfaceHeight(12,0),0);
  assert.equal(surfaceHeight(4,5),.16);
  for(const s of [-1,1]) {
    assert.equal(surfaceHeight(s*2.7,3.25),0);
    assert.ok(Math.abs(surfaceHeight(s*3.075,3.25)-.08)<1e-8);
    assert.equal(surfaceHeight(3.85,s*2.025),0);
    assert.ok(Math.abs(surfaceHeight(3.85,s*2.4)-.08)<1e-8);
  }
});
test('no scene prop of Black Rain stands on a tile the baked grid leaves as open ground', () => {
  // The bake's own classification (`app/scripts/build-map-preset.ts`): open and not a cover is `Empty` ground.
  const map = new TacticalMap(koraPlan);
  const stray = koraPlan.props.filter((prop) => {
    const cell: [number, number] = [Math.round(prop.x / CELL), Math.round(prop.z / CELL)];
    return map.inBounds(cell) && map.open(cell) && !map.isCover(cell);
  });
  assert.deepEqual(stray.map((prop) => `${prop.id} ${prop.kind}`), []);
});
test('the extraction cell is marked, not built over: nothing solid stands on the relay pad', () => {
  const map = new TacticalMap(koraPlan);
  assert.ok(map.open(blackRain.relay) && !map.isCover(blackRain.relay));
  const scene = new T.Scene();
  buildRelay(scene, { vec: (cell: [number, number], y = 0) => new T.Vector3(cell[0] * CELL, y, cell[1] * CELL) } as never, blackRain.relay);
  const meshes: T.Mesh[] = [];
  scene.traverse((o) => { if (o instanceof T.Mesh) meshes.push(o); });
  assert.ok(meshes.length > 0);
  for (const mesh of meshes) {
    assert.ok(mesh.material instanceof T.MeshBasicMaterial, 'a marker is unlit: the beacon and the ring');
    assert.ok(!mesh.castShadow);
  }
});

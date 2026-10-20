import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CELL, STREET, districtBuildings, footprint, surfaceHeight } from './district-plan.ts';
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

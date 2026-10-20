// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cityBlocks } from './city-blocks.ts';
import { CELL, STREET, districtBuildings, footprint } from './district-plan.ts';
const rects=cityBlocks().map(b=>{
  const w=Math.abs(Math.cos(b.rotation))*b.w+Math.abs(Math.sin(b.rotation))*b.d;
  const d=Math.abs(Math.cos(b.rotation))*b.d+Math.abs(Math.sin(b.rotation))*b.w;
  return {minX:b.x-w/2,maxX:b.x+w/2,minZ:b.z-d/2,maxZ:b.z+d/2};
});
const overlaps=(a,b)=>a.minX<b.maxX-1e-6&&a.maxX>b.minX+1e-6&&a.minZ<b.maxZ-1e-6&&a.maxZ>b.minZ+1e-6;
test('dense blocks never occupy mission cells, existing stores or through streets',()=>{
  const mission={minX:-9.5*CELL,maxX:8.5*CELL,minZ:-7.5*CELL,maxZ:6.5*CELL};
  for(const r of rects) {
    assert.ok(!overlaps(r,mission));
    assert.ok(r.minX>=STREET.avenueHalf || r.maxX<=-STREET.avenueHalf);
    assert.ok(r.minZ>=STREET.crossHalf || r.maxZ<=-STREET.crossHalf);
    for(const b of districtBuildings)assert.ok(!overlaps(r,footprint(b)));
  }
});
test('packed buildings retain separate footprints and narrow service gaps',()=>{
  assert.equal(rects.length,104);
  for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++)assert.ok(!overlaps(rects[i],rects[j]),`overlap ${i}/${j}`);
  assert.ok(new Set(cityBlocks().map(b=>b.h)).size>8);
});

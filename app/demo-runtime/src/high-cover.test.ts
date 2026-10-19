import {test} from 'node:test';import assert from 'node:assert/strict';import {coverPeek,highCoverAt,clearBuildingShot,coverStep} from './high-cover.ts';
test('building corner exposes shooter on a clear side without walking through wall',()=>{const plan=coverPeek([4,-3],[-1,-5]);assert(highCoverAt([4,-3]));assert(plan.high);assert(!plan.blocked);assert.notDeepEqual(plan.position,[5.4,-4.05]);assert(clearBuildingShot(plan.position,[-1.35,-6.75]));});
test('middle of a solid facade cannot shoot through the building',()=>{assert(coverPeek([-4,-5],[-9,-5]).blocked);assert(!clearBuildingShot([-5.4,-6.75],[-12.15,-6.75]));});
test('open roadway does not force a peek',()=>{assert.equal(coverPeek([0,0],[0,4]).high,false);assert(!coverPeek([0,0],[0,4]).blocked);});

import {Encounter} from './game.ts';
test('blocked wall shots consume neither AP nor ammunition',()=>{const game=new Encounter(),a=game.allies[0],b=game.enemies[0];a.pos=[-4,-5];b.pos=[-10,-5];const ap=a.ap,ammo=a.ammo;assert.equal(game.attack(a,b),null);assert.equal(a.ap,ap);assert.equal(a.ammo,ammo);});
test('high cover protects only the wall-facing direction',()=>{const game=new Encounter(),a=game.allies[0],b=game.enemies[0];a.pos=[-4,-5];b.pos=[-10,-5];assert.equal(game.cover(a,b),40);b.pos=[0,-5];assert.equal(game.cover(a,b),0);});

test('corner step cannot walk into a concrete barrier',()=>{const p=coverPeek([-5,-3],[0,-5]);assert(Math.abs(p.position[0]+6.75)<1e-6&&Math.abs(p.position[1]+4.05)<1e-6);});

test('Bishop next to the right-hand building steps right toward its north corner and left back into cover',()=>{
 const cell:[number,number]=[3,4],start:[number,number]=[4.05,5.4],plan=coverPeek(cell,[2,-3]);
 assert(plan.high&&!plan.blocked);assert(plan.position[1]<start[1]);
 const out=coverStep(cell,start,plan.position),back=coverStep(cell,plan.position,start);
 assert.equal(out.side,'right');assert.equal(back.side,'left');assert.equal(out.heading,Math.PI/2);assert.equal(back.heading,out.heading);
});
test('wall-relative steps select the correct side on all four facades',()=>{
 for(const [cell,from,to] of [
  [[3,-4],[4.05,-5.4],[4.05,-6.4]],
  [[9,-4],[12.15,-5.4],[12.15,-4.4]],
  [[4,-3],[5.4,-4.05],[4.4,-4.05]],
  [[4,-8],[5.4,-10.8],[6.4,-10.8]],
 ] as [ [number,number], [number,number], [number,number] ][]){
  const out=coverStep(cell,from,to),back=coverStep(cell,to,from);
  assert.equal(out.side,'right');assert.equal(back.side,'left');assert.equal(out.heading,back.heading);
 }
});

import {physicalCover,wallTravel} from './high-cover.ts';
test('low barrier approaches use running and kneeling, never the standing wall step',()=>{
 assert.equal(physicalCover([-3,3]),'low');assert.equal(physicalCover([-2,3]),'low');assert(!wallTravel([-3,3],[-2,3]));
 assert.equal(physicalCover([3,4]),'high');assert(wallTravel([3,4],[3,5]));assert(!wallTravel([2,4],[3,4]));
});

import {coverStance} from './high-cover.ts';
test('low cover faces the barrier and protects from all four cardinal directions',()=>{
 const game=new Encounter(),u=game.allies[0],a=game.enemies[0];
 for(const [dx,dz]of [[-1,0],[1,0],[0,-1],[0,1]]){
  u.pos=[dx,-4+dz];a.pos=[-dx*3,-4-dz*3];
  const pose=coverStance(u.pos);
  assert.equal(pose.kind,'low');assert.equal(game.cover(u,a),25);
  assert(Math.abs(-Math.sin(pose.heading!)+dx)<1e-8);
  assert(Math.abs(-Math.cos(pose.heading!)+dz)<1e-8);
  a.pos=[dx*3,-4+dz*3];assert.equal(game.cover(u,a),0,'flanked side is unprotected');
 }
});
test('wall stance faces out on each facade instead of retaining the arrival heading',()=>{
 for(const [cell,normal] of [
  [[-10,-5],[-1,0]],[[-4,-6],[1,0]],[[-7,-8],[0,-1]],[[-7,-3],[0,1]],
 ] as [[number,number],[number,number]][]){
  const pose=coverStance(cell);assert.equal(pose.kind,'high');
  assert(Math.abs(-Math.sin(pose.heading!)-normal[0])<1e-8);
  assert(Math.abs(-Math.cos(pose.heading!)-normal[1])<1e-8);
 }
});
test('storefront barrier keeps a low-cover stance even with a building immediately behind',()=>{
 const cell:[number,number]=[-5,-3];assert(highCoverAt(cell));
 assert.equal(physicalCover(cell),'low');assert.equal(coverStance(cell).heading,-Math.PI/2);
 assert(!wallTravel(cell,[-6,-3]));
 const game=new Encounter();game.allies[0].pos=cell;assert.equal(game.cover(game.allies[0]),25);
});

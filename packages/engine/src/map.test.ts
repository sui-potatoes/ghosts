import {test} from 'node:test';import assert from 'node:assert/strict';import {kora} from './district-plan.ts';
type P=readonly [number,number];
const coverPeek=(a:P,b:P)=>kora.coverPeek(a,b),highCoverAt=(c:P)=>kora.highCoverAt(c),clearBuildingShot=(a:P,b:P)=>kora.clearBuildingShot(a,b),coverStep=(c:P,a:P,b:P)=>kora.coverStep(c,a,b);
const physicalCover=(c:P)=>kora.physicalCover(c),wallTravel=(a:P,b:P)=>kora.wallTravel(a,b),coverStance=(c:P)=>kora.coverStance(c);
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

test('low barrier approaches use running and kneeling, never the standing wall step',()=>{
 assert.equal(physicalCover([-3,3]),'low');assert.equal(physicalCover([-2,3]),'low');assert(!wallTravel([-3,3],[-2,3]));
 assert.equal(physicalCover([3,4]),'high');assert(wallTravel([3,4],[3,5]));assert(!wallTravel([2,4],[3,4]));
});

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

import {blackRain} from './scenario.ts';
import {TacticalMap} from './map.ts';
test('a scenario can bring its own map: bounds, buildings and cover all come from the plan', () => {
 const yard = {id: 'yard', bounds: {minX: -3, maxX: 3, minZ: -3, maxZ: 3}, buildings: [], covers: [[0, 0]] as [number, number][], street: {avenueHalf: 99, crossHalf: 99, curb: 0, reach: 10}};
 const units = blackRain.units.filter(u => u.id === 'v' || u.id === 'h1').map((u, i) => ({...u, pos: [i ? 2 : -2, 0] as [number, number]}));
 const game = new Encounter({...blackRain, id: 'yard-test', map: yard, units, relay: [0, 2]});
 assert.ok(game.map instanceof TacticalMap);
 assert.equal(game.map.plan.id, 'yard');
 assert.equal(game.walkable([0, 0]), false, 'cover cells are not standing room');
 assert.equal(game.walkable([4, 0]), false, 'outside the yard');
 assert.equal(game.walkable([-6, -5]), false);
 assert.equal(game.map.highCoverAt([-6, -5]), undefined, 'no Kōra buildings here');
 const [v] = game.allies;
 assert.ok(game.paths(v).has('1,0'), 'vaults the barrier in the middle');
 v.pos = [-1, 0];assert.equal(game.cover(v), 25, 'beside the barrier');
 assert.equal(game.map.surfaceHeight(5, 5), 0);
});

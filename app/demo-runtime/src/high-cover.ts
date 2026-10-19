import { CELL, districtBuildings, footprint, lowCoverCells } from './district-plan.ts';
type Point = readonly [number, number];
const boxes = districtBuildings.map(footprint);
/** Test the entire shot segment against solid building footprints. */
export function clearBuildingShot(a: Point, b: Point) {
 return !boxes.some(box=>{
  let enter=0,exit=1;
  for(const [axis,min,max] of [[0,box.minX,box.maxX],[1,box.minZ,box.maxZ]] as const){
   const delta=b[axis]-a[axis];
   if(Math.abs(delta)<1e-8){if(a[axis]<=min||a[axis]>=max)return false;continue;}
   let t0=(min-a[axis])/delta,t1=(max-a[axis])/delta;if(t0>t1)[t0,t1]=[t1,t0];enter=Math.max(enter,t0);exit=Math.min(exit,t1);if(exit<=enter)return false;
  }
  return enter<.999 && exit>.001;
 });
}
export function highCoverAt(cell: Point) {
 const x=cell[0]*CELL,z=cell[1]*CELL;
 return boxes.find(b=>Math.hypot(Math.max(b.minX-x,0,x-b.maxX),Math.max(b.minZ-z,0,z-b.maxZ))<CELL*.72);
}
/** A short step around an actual wall corner, never a shot through a wall. */
export function coverPeek(cell: Point,target: Point) {
 const origin: [number,number]=[cell[0]*CELL,cell[1]*CELL],end: Point=[target[0]*CELL,target[1]*CELL],wall=highCoverAt(cell);
 if(!wall)return {high:false,position:origin,blocked:!clearBuildingShot(origin,end)};
 const candidates: [number,number][]=[];
 const margin=.38;
 if(origin[0]<=wall.minX||origin[0]>=wall.maxX){for(const z of [wall.minZ-margin,wall.maxZ+margin])candidates.push([origin[0],z]);}
 if(origin[1]<=wall.minZ||origin[1]>=wall.maxZ){for(const x of [wall.minX-margin,wall.maxX+margin])candidates.push([x,origin[1]]);}
 const clearStep=(p:Point)=>{
  for(let i=1;i<=8;i++){const x=origin[0]+(p[0]-origin[0])*i/8,z=origin[1]+(p[1]-origin[1])*i/8;
   if(lowCoverCells.some(c=>Math.abs(x-c[0]*CELL)<.83&&Math.abs(z-c[1]*CELL)<.54))return false;
  }return true;
 };
 const possible=candidates.filter(p=>clearStep(p)&&Math.hypot(p[0]-origin[0],p[1]-origin[1])<=1.65&&clearBuildingShot(origin,p)&&clearBuildingShot(p,end)).sort((a,b)=>Math.hypot(a[0]-origin[0],a[1]-origin[1])-Math.hypot(b[0]-origin[0],b[1]-origin[1]));
 return {high:true,position:possible[0]??origin,blocked:!possible.length&&!clearBuildingShot(origin,end)};
}

/** Side is relative to the wall-facing stance, never to screen/world X. */
export function coverStep(cell:Point,from:Point,to:Point) {
 const wall=highCoverAt(cell);
 if(!wall)throw new Error('Cover step requires an adjacent wall');
 const dx=to[0]-from[0],dz=to[1]-from[1];
 // Back against the wall, looking out. Travel stays tangent to that wall face.
 const facing: [number,number]=Math.abs(dx)>Math.abs(dz)?[0,cell[1]*CELL<wall.z?-1:1]:[cell[0]*CELL<wall.x?-1:1,0];
 const side=dx*-facing[1]+dz*facing[0]>=0?'right':'left';
 return {side,motion:side==='right'?'wall_step_right':'wall_step_left',heading:Math.atan2(-facing[0],-facing[1])} as const;
}

/** Adjacent barriers work from either grid axis, including their narrow ends. */
export function lowCoverAt(cell:Point) {
 return lowCoverCells.filter(c=>Math.abs(c[0]-cell[0])+Math.abs(c[1]-cell[1])===1);
}
export function physicalCover(cell:Point):'high'|'low'|'none' {
 // A wall behind the operator must not replace the crouch at a nearby barrier.
 if(lowCoverAt(cell).length)return 'low';
 return highCoverAt(cell)?'high':'none';
}
/** Pose orientation is relative to the obstacle face, independent of arrival. */
export function coverStance(cell:Point) {
 const low=lowCoverAt(cell)[0];
 if(low)return {kind:'low' as const,heading:Math.atan2(cell[0]-low[0],cell[1]-low[1])};
 const wall=highCoverAt(cell);if(!wall)return {kind:'none' as const,heading:null};
 const x=cell[0]*CELL,z=cell[1]*CELL;
 const faces=[
  {gap:Math.abs(x-wall.minX),normal:[-1,0]},
  {gap:Math.abs(x-wall.maxX),normal:[1,0]},
  {gap:Math.abs(z-wall.minZ),normal:[0,-1]},
  {gap:Math.abs(z-wall.maxZ),normal:[0,1]},
 ].sort((a,b)=>a.gap-b.gap);
 const [nx,nz]=faces[0].normal;
 // Standing wall poses put the back to the wall; low poses face the barrier.
 return {kind:'high' as const,heading:Math.atan2(-nx,-nz)};
}
export function wallTravel(from:Point,to:Point) {
 if(physicalCover(from)!=='high'||physicalCover(to)!=='high')return false;
 const a=highCoverAt(from),b=highCoverAt(to);
 return !!a&&a===b;
}

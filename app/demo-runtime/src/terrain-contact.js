import * as T from 'three';
import {soleProbeIndices} from './sole-contact.js';
import {setWorldRotation,solveLeg} from './two-bone-ik.js';
const point=new T.Vector3();
/** Restore the baked pose before AnimationMixer applies a possibly paused action. */
export function restoreTerrainPose(model){
 const saved=model.userData.terrainPose;if(!saved)return;
 for(const[b,q,p]of saved){b.quaternion.copy(q);b.position.copy(p);}model.userData.terrainPose=null;
}
/** Feet sample their own pavement height; the grid-cell centre is not a foot contact. */
export function fitTerrainFeet(model,root,height){
 const mesh=model.getObjectByName('Blackline_Face');if(!mesh?.isSkinnedMesh)return;
 const bones=mesh.userData.terrainBones??=Object.fromEntries(mesh.skeleton.bones.map(b=>[b.name.replaceAll(':',''),b]));
 const rootY=root.getWorldPosition(point).y;
 // Skip the surface sampling on level ground: inspect ankle and toe locations first.
 let uneven=false;
 for(const side of ['Left','Right'])for(const suffix of ['Foot','ToeBase']){const b=bones['mixamorig'+side+suffix];b.getWorldPosition(point);if(Math.abs(height(point.x,point.z)-rootY)>.002)uneven=true;}
 if(!uneven)return;
 const indices=mesh.userData.soleProbes??=soleProbeIndices(mesh.geometry),contacts={Left:{min:Infinity,floor:-Infinity},Right:{min:Infinity,floor:-Infinity}};
 for(const b of mesh.skeleton.bones)if(/(?:Leg|Foot|ToeBase)$/.test(b.name))b.updateWorldMatrix(true,false);
 mesh.updateWorldMatrix(true,false);mesh.updateMatrixWorld(true);
 for(const i of indices){const side=mesh.geometry.attributes.position.getX(i)>0?'Left':'Right';point.fromBufferAttribute(mesh.geometry.attributes.position,i);mesh.applyBoneTransform(i,point).applyMatrix4(mesh.matrixWorld);contacts[side].min=Math.min(contacts[side].min,point.y);contacts[side].floor=Math.max(contacts[side].floor,height(point.x,point.z));}
 const saved=[],goals={},rotations={};let drop=0;
 const hips=bones.mixamorigHips;saved.push([hips,hips.quaternion.clone(),hips.position.clone()]);
 for(const side of ['Left','Right']){
  const chain=['UpLeg','Leg','Foot','ToeBase'].map(s=>bones['mixamorig'+side+s]);for(const b of chain)saved.push([b,b.quaternion.clone(),b.position.clone()]);
  const[a,b,c]=chain.map(b=>b.getWorldPosition(new T.Vector3())),goal=c.clone();goal.y+=contacts[side].floor-rootY;goals[side]=goal;rotations[side]=chain.slice(2).map(b=>b.getWorldQuaternion(new T.Quaternion()));
  const reach=a.distanceTo(b)+b.distanceTo(c)-.0005,dx=goal.x-a.x,dz=goal.z-a.z;drop=Math.max(drop,a.y-goal.y-Math.sqrt(Math.max(0,reach*reach-dx*dx-dz*dz)));
 }
 model.userData.terrainPose=saved;
 if(drop>0){const p=hips.getWorldPosition(new T.Vector3());p.y-=drop;hips.position.copy(hips.parent.worldToLocal(p));hips.updateMatrixWorld(true);}
 for(const side of ['Left','Right']){
  const foot=bones['mixamorig'+side+'Foot'],toe=bones['mixamorig'+side+'ToeBase'];solveLeg(bones['mixamorig'+side+'UpLeg'],bones['mixamorig'+side+'Leg'],foot,goals[side]);setWorldRotation(foot,rotations[side][0]);setWorldRotation(toe,rotations[side][1]);
 }
}

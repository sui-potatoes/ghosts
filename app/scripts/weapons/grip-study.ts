import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import * as T from 'three';
import {motionSkeleton} from '@ghosts/squad/motion/clearance';
import {nativeClip} from '@ghosts/squad/motion/clips';
import {equipmentPose} from '@ghosts/squad/motion/equipment-poses';
import {mountHandEquipment} from '@ghosts/squad/studio/held-equipment';
import {supportGrip} from '../equipment-fit/support-grip.ts';
import {createLongGun} from "@ghosts/squad/studio/long-guns";
import {skinMeshes, posedSurface, weaponEdges} from '../../tests/gear-collision.ts';
for(const sex of ['female','male']) {
 const file=fs.readFileSync(`public/squad/body/${sex}/skin.glb`);
 const root=motionSkeleton(file.buffer.slice(file.byteOffset,file.byteOffset+file.length));
 const skins=skinMeshes(`public/squad/body/${sex}/skin.glb`,root);
 const gun=new T.Group();gun.userData.center=[0,0,0];gun.userData.model='sniper';
 mountHandEquipment(gun,root.getObjectByName('mixamorigRightHand') as T.Bone,JSON.parse(fs.readFileSync(`public/squad/body/${sex}/weapon-mount.json`,'utf8')));
 const poses=JSON.parse(gunzipSync(fs.readFileSync(`public/squad/motions/${sex}-equipment.bin`)).toString());
 const clips=JSON.parse(gunzipSync(fs.readFileSync(`public/squad/motions/${sex}.bin`)).toString());
 for(const name of ['rifle_idle','rifle_burst','sniper_shot']){
 const clip=equipmentPose(nativeClip(T.AnimationClip.parse(clips.find((c:any)=>c.name===name))),poses);
 const mixer=new T.AnimationMixer(root);mixer.clipAction(clip).play();mixer.setTime(.8);root.updateMatrixWorld(true);
 supportGrip(root,gun,sex);root.updateMatrixWorld(true);
 const surface=posedSurface(skins);
 for(const kind of ['rifle','sniper','plasma'] as const) {
 const model=createLongGun(kind,{laser:'laser-3'});
 model.quaternion.setFromRotationMatrix(new T.Matrix4().makeBasis(new T.Vector3(0,0,-1),new T.Vector3(1,0,0),new T.Vector3(0,-1,0)));
 gun.add(model);root.updateMatrixWorld(true);
 const hits=weaponEdges(model).flatMap(([a,b])=>surface.segment(a,b)).filter(h=>h.region.includes('LeftHand'));
 console.log(kind,sex,name,hits.length,JSON.stringify(hits.slice(0,5).map(h=>({r:h.region,p:gun.worldToLocal(new T.Vector3(...h.point)).toArray()}))));
 gun.remove(model);
 }
 const local=(v:T.Vector3)=>gun.worldToLocal(v).toArray().map(v=>+v.toFixed(4));
 const bones:any={};root.traverse(b=>{if(b.name.startsWith('mixamorigLeftHand')) bones[b.name.replace('mixamorigLeftHand','')]=local(b.getWorldPosition(new T.Vector3()));});
 const points:any=[];
 for(const mesh of skins){mesh.skeleton.update();const a=mesh.geometry.attributes;for(let i=0;i<a.position.count;i++){let hand=0;for(let k=0;k<4;k++)if(mesh.skeleton.bones[a.skinIndex.getComponent(i,k)].name.startsWith('mixamorigLeftHand'))hand+=a.skinWeight.getComponent(i,k);if(hand>.5)points.push(local(mesh.applyBoneTransform(i,new T.Vector3().fromBufferAttribute(a.position,i)).applyMatrix4(mesh.matrixWorld)));}}
 console.log(JSON.stringify({sex,name,bones,bounds:new T.Box3().setFromPoints(points.map((p:any)=>new T.Vector3(...p)))}));
 fs.writeFileSync(`/tmp/grip-${sex}-${name}.json`,JSON.stringify(points));
 mixer.stopAllAction();mixer.uncacheRoot(root);
 }
}

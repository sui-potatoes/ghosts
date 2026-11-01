// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from 'three';
import {demoAsset} from './demo-assets';
import {loadMotions,captureClip} from '@ghosts/squad/motion/clips';
import {CharacterAssets} from '@ghosts/squad/studio/character-assets';
import {schema} from '@ghosts/squad/appearance/schema';
import {normalize} from '@ghosts/squad/appearance/editor-state';
import {installBlush,updateBlush} from '@ghosts/squad/appearance/skin-blush';
import {installScars,updateScars} from '@ghosts/squad/appearance/skin-scars';
import {bindNativeSkeleton,remapNativeWeights,installBodySuit} from '@ghosts/squad/appearance/native-body-binding';
import {applyDeploymentNames} from './squad-bridge';

// Squad and combat now share one asset/morph/gear builder. Only the animation
// adapter is demo-specific: native meshes bind to the existing combat rig.
const assets=new CharacterAssets(), prepared=new Map(), nativeRigs=new Map();
export let deployment=new Map();
export function nativeAnimations(sex,weapon="rifle"){const rig=nativeRigs.get(sex);return weapon==="sniper"?rig.sniperAnimations:rig.animations;}
async function rigFor(sex){
 if(!nativeRigs.has(sex)){
  const [rig,clips,sniperClips]=await Promise.all([
   fetch(demoAsset(`combat/${sex}/rig.json`)).then(r=>{if(!r.ok)throw Error('Missing combat rig');return r.json();}),
   loadMotions(sex),loadMotions(sex,"sniper")
  ]);
  nativeRigs.set(sex,{...rig,animations:[...clips.values()].map(captureClip),sniperAnimations:[...sniperClips.values()].map(captureClip)});
 }
}
async function prepare(state,look){
 const s=normalize(state,schema);
 await rigFor(s.sex);
 const character=await assets.create(s,look.armorId,'rest');
 character.setArmorColors(look.armorColors);
 const records=[];
 character.root.traverse(mesh=>{
  if(!mesh.isSkinnedMesh)return;
  records.push({key:mesh.userData.nativePart,g:mesh.geometry,material:mesh.material,
   base:mesh.userData.base,top:mesh.userData.nativeTop,nativeSkeleton:mesh.skeleton});
 });
 return{state:s,records,character,armorId:look.armorId};
}
/** Build every unit's character from its deployment look (`squad-bridge.ts`). */
export async function loadNativeIdentities(units,looks){
 deployment=looks;
 applyDeploymentNames(units,deployment);
 for(const unit of units){
  const look=deployment.get(unit.id),next=await prepare(look.appearance,look);
  prepared.get(unit.id)?.character.dispose();
  prepared.set(unit.id,next);
 }
}
export function attachNativeBody(model,id){
 const data=prepared.get(id);if(!data)throw Error('MPFB identity not prepared: '+id);
 model.updateMatrixWorld(true);
 let donor=model.userData.mpfbDonor;
 if(!donor){donor=model.getObjectByName('Blackline_Face');if(!donor?.isSkinnedMesh)throw Error('Combat head skin binding is missing');model.userData.mpfbDonor=donor;model.userData.mpfbParent=donor.parent;}
 const skeleton=donor.skeleton,nativeSkeleton=data.records.find(r=>r.key==='skin').nativeSkeleton,rig=nativeRigs.get(data.state.sex);
 model.userData.terrainPose=null;bindNativeSkeleton(skeleton,rig);model.userData.mpfbSex=data.state.sex;
 model.userData.bodyHeightScale=data.character.heightScale;
 model.scale.setScalar(.96*data.character.heightScale);
 const weapon=model.getObjectByName('WeaponMount')??model.getObjectByName('Rifle');
 if(!model.userData.nativeWeaponRest)model.userData.nativeWeaponRest={position:weapon.position.clone(),quaternion:weapon.quaternion.clone()};
 const correction=new T.Quaternion().fromArray(rig.gunCorrection),weaponRest=model.userData.nativeWeaponRest;
 weapon.position.copy(weaponRest.position).applyQuaternion(correction).add(new T.Vector3().fromArray(rig.gunTranslation??[0,0,0]));weapon.quaternion.copy(correction).multiply(weaponRest.quaternion);
 // The native skin is a complete body. Keep the rig and held weapon; remove every old body/equipment mesh.
 const remove=[];model.traverse(o=>{if(o.isMesh&&o.name!=='Rifle'&&!o.parent?.name?.includes('WeaponMount')&&!o.userData.weaponPart)remove.push(o);});
 // On subsequent edits only replace native surfaces; the body equipment was already removed.
 for(const o of remove){if(model.userData.mpfb&&!o.userData.mpfbPart)continue;o.removeFromParent();if(o.userData.mpfbPart){o.geometry.dispose();o.material.dispose();}}
 for(const r of data.records){
  const geometry=r.g.clone(),material=r.material.clone();
  const mesh=new T.SkinnedMesh(geometry,material);mesh.name=r.key==='skin'?'Blackline_Face':r.key==='eyes'?'MPFB_Eyes':'MPFB_'+r.key;
  mesh.userData.mpfbPart=true;mesh.userData.fieldKit=r.key==='field-kit';mesh.userData.fieldArmor=r.key==='armor';if(r.key==='armor')mesh.visible=model.userData.armorVisible!==false;mesh.userData.base=r.base;mesh.userData.original=material;
  if(r.key==='skin'){installBlush(mesh,r.top);updateBlush(mesh,data.state);installScars(mesh,r.top);updateScars(mesh,data.state);installBodySuit(mesh,r.top,nativeSkeleton,data.armorId?.startsWith('nyx')??false);}
  remapNativeWeights(geometry,r.nativeSkeleton,skeleton,true);
  mesh.position.copy(donor.position);mesh.quaternion.copy(donor.quaternion);mesh.scale.copy(donor.scale);
  mesh.bindMode=donor.bindMode;mesh.bindMatrix.copy(donor.bindMatrix);mesh.bindMatrixInverse.copy(donor.bindMatrixInverse);mesh.skeleton=skeleton;mesh.frustumCulled=false;
  (model.userData.mpfbParent??model).add(mesh);geometry.computeBoundingSphere();
 }

 model.userData.fieldKit=true;
 model.userData.mpfb=true;model.userData.mpfbIdentity=id;
}

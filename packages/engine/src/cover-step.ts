// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from 'three';
const cache=new WeakMap<T.AnimationClip[],T.AnimationClip[]>();
/** Keep captured wall idles, peeks and steps aligned to their obstacle face.
 * Only pelvis yaw is stabilized; limb articulation, grip and foot timing remain captured.
 */
export function coverStepClips(model:T.Object3D, source:T.AnimationClip[]) {
 const cached=cache.get(source);if(cached)return cached;
 const hips=model.getObjectByName('mixamorigHips')!,left=model.getObjectByName('mixamorigLeftUpLeg')!,right=model.getObjectByName('mixamorigRightUpLeg')!;
 const lateral=right.position.clone().sub(left.position).normalize(),parent=hips.parent!.getWorldQuaternion(new T.Quaternion()),inverse=parent.clone().invert();
 const interpolate=(t:T.KeyframeTrack)=>t instanceof T.QuaternionKeyframeTrack?new T.QuaternionLinearInterpolant(t.times,t.values,t.getValueSize()):new T.LinearInterpolant(t.times,t.values,t.getValueSize());
 const reference=lateral.clone().applyQuaternion(hips.getWorldQuaternion(new T.Quaternion())).setY(0).normalize();
 const result=[['stand_cover_move','wall_step_right'],['cover_move_left','wall_step_left'],['stand_cover_idle','wall_idle'],['cover_peek','wall_peek']].map(([name,result])=>{
  const clip=source.find(c=>c.name===name)!,step=result.startsWith('wall_step'),from=step ? .25 : 0,to=step?Math.min(1.55,clip.duration):clip.duration;
  const tracks=clip.tracks.map(original=>{
   const sample=interpolate(original),times=[from,...Array.from(original.times).filter(t=>t>from&&t<to),to],values:number[]=[];
   for(const time of times){const value=Array.from(sample.evaluate(time) as ArrayLike<number>);
    if(original.name==='mixamorigHips.quaternion'){
     const q=new T.Quaternion().fromArray(value),current=lateral.clone().applyQuaternion(q.clone().premultiply(parent)).setY(0).normalize();
     const yaw=Math.atan2(current.x*reference.z-current.z*reference.x,current.dot(reference));
     q.premultiply(parent).premultiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),-yaw)).premultiply(inverse).normalize();
     values.push(...q.toArray());
    }else values.push(...value);
   }
   const track=original.clone();track.times=new Float32Array(times.map(t=>t-from));track.values=new Float32Array(values);return track;
  });
  return new T.AnimationClip(result,to-from,tracks);
 });
 cache.set(source,result);return result;
}

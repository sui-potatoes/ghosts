// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from 'three';
const forward=new T.Vector3(0,0,1);
export function setWorldRotation(bone,rotation){bone.quaternion.copy(bone.parent.getWorldQuaternion(new T.Quaternion()).invert().multiply(rotation));bone.updateMatrixWorld(true);}
/** Analytic two-bone solve. Only rotations change; native limb lengths stay intact. */
export function solveLeg(hip,knee,ankle,goal){
 const a=hip.getWorldPosition(new T.Vector3()),b=knee.getWorldPosition(new T.Vector3()),c=ankle.getWorldPosition(new T.Vector3()),ab=b.clone().sub(a),bc=c.clone().sub(b),lengthA=ab.length(),lengthB=bc.length(),axis=goal.clone().sub(a),distance=T.MathUtils.clamp(axis.length(),Math.abs(lengthA-lengthB)+1e-6,lengthA+lengthB-1e-6);axis.normalize();
 const pole=ab.clone().addScaledVector(axis,-ab.dot(axis));if(pole.lengthSq()<1e-8)pole.copy(forward).addScaledVector(axis,-forward.dot(axis));pole.normalize();
 const along=(lengthA*lengthA-lengthB*lengthB+distance*distance)/(2*distance),height=Math.sqrt(Math.max(0,lengthA*lengthA-along*along)),bend=a.clone().addScaledVector(axis,along).addScaledVector(pole,height);
 setWorldRotation(hip,new T.Quaternion().setFromUnitVectors(ab.normalize(),bend.clone().sub(a).normalize()).multiply(hip.getWorldQuaternion(new T.Quaternion())));
 const current=knee.getWorldPosition(new T.Vector3()),end=ankle.getWorldPosition(new T.Vector3());
 setWorldRotation(knee,new T.Quaternion().setFromUnitVectors(end.sub(current).normalize(),goal.clone().sub(current).normalize()).multiply(knee.getWorldQuaternion(new T.Quaternion())));
}

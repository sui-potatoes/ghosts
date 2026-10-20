// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
/** Use posed facial landmarks, so a tilted idle cannot turn the studio into an overhead shot. */
export function portraitFrame(head: T.Mesh, eyes: T.Mesh) {
  const positions = head.geometry.getAttribute("position");
  const landmark = (x: number, y: number, z: number) => {
    const goal = new T.Vector3(x, y, z),
      p = new T.Vector3();
    let best = 0,
      distance = Infinity;
    for (let i = 0; i < positions.count; i++) {
      p.fromBufferAttribute(positions, i);
      const d = p.distanceToSquared(goal);
      if (d < distance) {
        best = i;
        distance = d;
      }
    }
    const vertex = new T.Vector3().fromBufferAttribute(positions, best);
    if (head instanceof T.SkinnedMesh) head.applyBoneTransform(best, vertex);
    return vertex.applyMatrix4(head.matrixWorld);
  };
  const native = head.userData.mpfbPart && head instanceof T.SkinnedMesh;
  const headJoint = native ? head.skeleton.bones.findIndex(b=>b.name.endsWith('Head')) : -1;
  const posedHead = native && headJoint>=0 ? head.matrixWorld.clone().multiply(head.bindMatrixInverse).multiply(head.skeleton.bones[headJoint].matrixWorld).multiply(head.skeleton.boneInverses[headJoint]).multiply(head.bindMatrix) : null;
  const right = landmark(0.035, 1.674, 0.103)
    .sub(landmark(-0.035, 1.674, 0.103))
    .normalize();
  const up = landmark(0, 1.708, 0.12)
    .sub(landmark(0, 1.575, 0.111))
    .normalize();
  const forward = new T.Vector3().crossVectors(right, up).normalize();
  up.crossVectors(forward, right).normalize();
  if(posedHead){forward.set(0,0,1).transformDirection(posedHead);up.set(0,1,0).transformDirection(posedHead);}
  // Identity sliders must not move the camera when reopening the editor.
  const eyeBounds = new T.Box3(),
    eyePosition = eyes.geometry.getAttribute("position"),
    vertex = new T.Vector3();
  for (let i = 0; i < eyePosition.count; i++) {
    vertex.fromBufferAttribute(eyePosition, i);
    if (eyes instanceof T.SkinnedMesh) eyes.applyBoneTransform(i, vertex);
    eyeBounds.expandByPoint(vertex.applyMatrix4(eyes.matrixWorld));
  }
  const center = eyeBounds.getCenter(new T.Vector3());
  const faceBounds = new T.Box3();
  if(native && headJoint>=0){
    const joints=head.geometry.getAttribute('skinIndex'),weights=head.geometry.getAttribute('skinWeight');
    right.crossVectors(up,forward).normalize();
    for(let i=0;i<positions.count;i++){
      let influence=0;for(let k=0;k<4;k++)if(joints.getComponent(i,k)===headJoint)influence+=weights.getComponent(i,k);
      if(influence<.8)continue; // Skull/jaw, excluding neck and torso.
      vertex.fromBufferAttribute(positions,i);head.applyBoneTransform(i,vertex);vertex.applyMatrix4(head.matrixWorld).sub(center);
      faceBounds.expandByPoint(new T.Vector3(vertex.dot(right),vertex.dot(up),vertex.dot(forward)));
    }
  }
  return { center, up, forward, faceBounds };

}
export function portraitCameraPose(
  frame: Pick<ReturnType<typeof portraitFrame>, "center" | "up" | "forward">,
  yaw: number,
  close: boolean,
) {
  const direction = frame.forward
    .clone()
    .applyAxisAngle(frame.up, (yaw * Math.PI) / 180);
  return {
    position: frame.center
      .clone()
      .addScaledVector(direction, close ? 0.58 : 0.95),
    target: frame.center.clone(),
    up: frame.up.clone(),
  };
}

/** Fit the actual posed skull and jaw into a square icon, independent of stature. */
export function portraitIconPose(frame:ReturnType<typeof portraitFrame>,fov=28,aspect=1){
 const {faceBounds:bounds,up,forward}=frame;
 if(bounds.isEmpty())return portraitCameraPose(frame,0,true);
 const right=new T.Vector3().crossVectors(up,forward).normalize(),mid=bounds.getCenter(new T.Vector3());
 const target=frame.center.clone().addScaledVector(right,mid.x).addScaledVector(up,mid.y);
 const tanV=Math.tan(T.MathUtils.degToRad(fov/2)),tanH=tanV*aspect,fill=.82;
 let distance=0;
 for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z])
  distance=Math.max(distance,z+Math.max(Math.abs(x-mid.x)/(tanH*fill),Math.abs(y-mid.y)/(tanV*fill)));
 return {position:target.clone().addScaledVector(forward,distance),target,up:up.clone()};
}

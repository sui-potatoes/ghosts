import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
// @ts-ignore Runtime native contact helper.
import { soleMinimum } from './sole-contact.js';

test('grounding follows equipped soles, including skinning and world translation',()=>{
  const group=new T.Group(),bone=new T.Bone();bone.name='mixamorigLeftFoot';
  group.add(bone);const skeleton=new T.Skeleton([bone]);
  function mesh(y:number,kit=false){
    const g=new T.BufferGeometry();
    g.setAttribute('position',new T.Float32BufferAttribute([.1,y,.1,-.1,y,.1],3));
    g.setAttribute('skinIndex',new T.Uint16BufferAttribute(new Array(8).fill(0),4));
    g.setAttribute('skinWeight',new T.Float32BufferAttribute([1,0,0,0,1,0,0,0],4));
    const result=new T.SkinnedMesh(g,new T.MeshBasicMaterial());
    result.bind(skeleton);result.userData.fieldKit=kit;group.add(result);return result;
  }
  const body=mesh(.01);assert.ok(Math.abs(soleMinimum(body)-.01)<1e-6);
  mesh(-.02,true);group.position.y=.4;bone.position.y=.05;group.updateMatrixWorld(true);
  assert.ok(Math.abs(soleMinimum(body)-.43)<1e-6);
});

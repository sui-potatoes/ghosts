import{test}from'node:test';import assert from'node:assert/strict';import{Vector3}from'three';import{shoulderArc,shortestAngle}from'./aim-transition.ts';
test('target switches orbit the shoulder without passing through the character',()=>{
 const pivot=new Vector3(3,.16,5),a=new Vector3(3,1.5,7.5),b=new Vector3(3,1.5,2.5),out=new Vector3();
 for(let i=0;i<=100;i++){shoulderArc(a,b,pivot,i/100,out);assert(Math.abs(Math.hypot(out.x-pivot.x,out.z-pivot.z)-2.5)<1e-8);}
 assert(out.distanceTo(b)<1e-8);assert(Math.abs(shortestAngle(Math.PI-.1,-Math.PI+.1)-.2)<1e-8);
});

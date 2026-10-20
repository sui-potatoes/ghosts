import * as T from 'three';
export function shortestAngle(from:number,to:number) {
 return Math.atan2(Math.sin(to-from),Math.cos(to-from));
}
/** Orbit outside the shooter when switching targets, instead of cutting through them. */
export function shoulderArc(start:T.Vector3,end:T.Vector3,pivot:T.Vector3,t:number,out:T.Vector3) {
 const a=start.clone().sub(pivot),b=end.clone().sub(pivot),angle=Math.atan2(a.x,a.z)+shortestAngle(Math.atan2(a.x,a.z),Math.atan2(b.x,b.z))*t;
 const radius=T.MathUtils.lerp(Math.hypot(a.x,a.z),Math.hypot(b.x,b.z),t);
 return out.set(pivot.x+Math.sin(angle)*radius,T.MathUtils.lerp(start.y,end.y,t),pivot.z+Math.cos(angle)*radius);
}

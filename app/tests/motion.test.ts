// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import * as T from "three";
import { nativeClip } from "@ghosts/squad/motion/clips";
import { motions } from "@ghosts/squad/motion/catalog";
import { MotionPlayer, STOPPED, type MotionState } from "@ghosts/squad/motion/player";
import { soleMinimum } from "@ghosts/squad/motion/sole-contact";

for (const sex of ["female", "male"]) test(`${sex}: every drill binds to the current native rig, with finite in-place tracks`, () => {
    const file = readFileSync(`public/squad/body/${sex}/skin.glb`);
    const gltf = JSON.parse(file.subarray(20, 20 + file.readUInt32LE(12)).toString());
    const bones = new Set(gltf.nodes.map((n: { name?: string }) => T.PropertyBinding.sanitizeNodeName(n.name ?? "")));
    const library = JSON.parse(gunzipSync(readFileSync(`public/squad/motions/${sex}.bin`)).toString());
    for (const [name] of motions) {
        const source = library.find((c: { name: string }) => c.name === name);
        assert.ok(source, name);
        const clip = nativeClip(T.AnimationClip.parse(source), true);
        for (const track of clip.tracks) {
            assert.ok(bones.has(track.name.split('.')[0]), track.name);
            assert.ok(Array.from(track.values).every(Number.isFinite));
        }
        const hip = clip.tracks.find(t => t.name === 'mixamorigHips.position')!;
        assert.ok(hip);
        for (let i = 0; i < hip.values.length; i += 3) {
            assert.equal(hip.values[i], 0); assert.equal(hip.values[i + 2], 0);
            assert.ok(Math.abs(hip.values[i + 1]) < 3, `${name}: metre conversion`);
        }
    }
});
test('conversion preserves source data and maps vertical movement into Y', () => {
    const source = new T.AnimationClip('jump', 1, [new T.VectorKeyframeTrack('mixamorigHips.position',[0,1],[10,20,-100,30,40,-150])]);
    const converted = nativeClip(source,true).tracks[0].values;
    assert.deepEqual(Array.from(converted),[0,1,0,0,1.5,0]);
    assert.deepEqual(Array.from(source.tracks[0].values),[10,20,-100,30,40,-150]);
});
test('pause, seek, hidden tabs, completion and disposal stop rendering and restore the studio pose', () => {
    const doc = new EventTarget() as EventTarget & { hidden: boolean }; doc.hidden = false;
    const callbacks = new Map<number, FrameRequestCallback>(); let id = 0;
    const originals = [globalThis.document, globalThis.requestAnimationFrame, globalThis.cancelAnimationFrame];
    Object.assign(globalThis, {document: doc, requestAnimationFrame: (cb: FrameRequestCallback) => { callbacks.set(++id,cb); return id; }, cancelAnimationFrame: (key: number) => callbacks.delete(key)});
    try {
        const root = new T.Group(), bone = new T.Bone(); bone.name = 'joint'; bone.position.y = 2; root.add(bone); root.position.y = .05;
        let state: MotionState = STOPPED; let draws = 0;
        const player = new MotionPlayer(root,()=>draws++,s=>state=s);
        const clip = new T.AnimationClip('test',1,[new T.NumberKeyframeTrack('joint.position[y]',[0,1],[0,1])]);
        player.play(clip,false,1); assert.equal(callbacks.size,1);
        player.seek(.5); assert.equal(callbacks.size,0); assert.equal(bone.position.y,.5); assert.equal(state.playing,false);
        player.resume(); assert.equal(callbacks.size,1);
        doc.hidden=true;doc.dispatchEvent(new Event('visibilitychange'));assert.equal(callbacks.size,0);
        doc.hidden=false;doc.dispatchEvent(new Event('visibilitychange'));assert.equal(callbacks.size,1);
        for(let now=100;now<=1500;now+=50){const pending=[...callbacks.values()];callbacks.clear();for(const cb of pending)cb(now);}
        assert.equal(state.playing,false);assert.equal(callbacks.size,0);assert.equal(state.time,1);
        player.stop();assert.equal(bone.position.y,2);assert.equal(root.position.y,.05);assert.deepEqual(state,STOPPED);
        player.play(clip,true,1);player.dispose();assert.equal(callbacks.size,0);
        const count=draws;doc.dispatchEvent(new Event('visibilitychange'));assert.equal(callbacks.size,0);assert.equal(draws,count);
    } finally { Object.assign(globalThis,{document:originals[0],requestAnimationFrame:originals[1],cancelAnimationFrame:originals[2]}); }
});
test('ground contact uses boots instead of hidden bare feet',()=>{
    const root=new T.Group(),bone=new T.Bone();bone.name='mixamorigLeftFoot';root.add(bone);
    const skeleton=new T.Skeleton([bone]);
    function mesh(y:number,part:string){
        const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute([.1,y,.1,-.1,y,.1],3));
        g.setAttribute('skinIndex',new T.Uint16BufferAttribute(new Array(8).fill(0),4));g.setAttribute('skinWeight',new T.Float32BufferAttribute([1,0,0,0,1,0,0,0],4));
        const m=new T.SkinnedMesh(g,new T.MeshBasicMaterial());m.bind(skeleton);m.userData.nativePart=part;root.add(m);return m;
    }
    const body=mesh(.01,'skin');mesh(-.02,'field-kit');bone.position.y=.05;root.updateMatrixWorld(true);
    assert.ok(Math.abs(soleMinimum(body)-.03)<1e-6);
});

// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import { soleMinimum } from "./sole-contact.ts";

export interface MotionState {
    active: boolean;
    playing: boolean;
    time: number;
    duration: number;
}
export const STOPPED: MotionState = { active: false, playing: false, time: 0, duration: 0 };

/** One preview mixer; no combat state, root travel or idle rendering loop. */
export class MotionPlayer {
    private mixer: T.AnimationMixer;
    private action?: T.AnimationAction;
    private raf = 0;
    private last = 0;
    private playing = false;
    private looping = false;
    private speed = 1;
    private baseY: number;
    private body?: T.SkinnedMesh;
    private root: T.Group;
    private draw: () => void;
    private report: (state: MotionState) => void;
    private pose: (name?: string) => void;
    constructor(
        root: T.Group,
        draw: () => void,
        report: (state: MotionState) => void,
        pose: (name?: string) => void = () => {},
    ) {
        this.pose = pose;
        this.root = root;
        this.draw = draw;
        this.report = report;
        root.traverse((object) => {
            if (object instanceof T.SkinnedMesh && object.userData.nativePart === "skin")
                this.body = object;
        });
        this.mixer = new T.AnimationMixer(root);
        this.baseY = root.position.y;
        document.addEventListener("visibilitychange", this.visibility);
    }
    private visibility = () => {
        cancelAnimationFrame(this.raf);
        this.raf = 0;
        this.last = 0;
        if (!document.hidden && this.playing) this.raf = requestAnimationFrame(this.tick);
    };
    private status() {
        this.report(
            this.action
                ? {
                      active: true,
                      playing: this.playing,
                      time: this.action.time,
                      duration: this.action.getClip().duration,
                  }
                : STOPPED,
        );
    }
    private renderPose() {
        this.root.position.y = 0;
        if (this.body) {
            const floor = soleMinimum(this.body);
            if (Number.isFinite(floor) && floor < 0) this.root.position.y = -floor;
        }
        this.pose(this.action?.getClip().name);
        this.draw();
    }
    private tick = (now: number) => {
        this.raf = 0;
        if (!this.playing || document.hidden) return;
        if (!this.last) this.last = now;
        const delta = now - this.last;
        if (delta >= 1000 / 30) {
            this.last = now;
            this.mixer.update(Math.min(delta / 1000, 0.1) * this.speed);
            if (this.action?.paused && !this.looping) this.playing = false;
            this.renderPose();
            this.status();
        }
        if (this.playing) this.raf = requestAnimationFrame(this.tick);
    };
    play(clip: T.AnimationClip, loop: boolean, speed: number) {
        this.stop();
        this.root.position.y = 0;
        this.looping = loop;
        this.speed = speed;
        this.action = this.mixer.clipAction(clip);
        this.action.setLoop(loop ? T.LoopRepeat : T.LoopOnce, loop ? Infinity : 1);
        this.action.clampWhenFinished = true;
        this.action.reset().play();
        this.mixer.update(0);
        this.playing = true;
        this.status();
        this.renderPose();
        this.visibility();
    }
    pause() {
        this.playing = false;
        cancelAnimationFrame(this.raf);
        this.raf = 0;
        this.status();
    }
    resume() {
        if (!this.action) return;
        if (this.action.time >= this.action.getClip().duration) this.action.time = 0;
        this.action.paused = false;
        this.playing = true;
        this.status();
        this.visibility();
    }
    seek(time: number) {
        if (!this.action) return;
        this.pause();
        this.action.paused = false;
        this.action.time = T.MathUtils.clamp(time, 0, this.action.getClip().duration);
        this.mixer.update(0);
        this.renderPose();
        this.status();
    }
    stop() {
        this.pause();
        this.pose();
        this.mixer.stopAllAction();
        this.action = undefined;
        this.root.position.y = this.baseY;
        this.root.updateMatrixWorld(true);
        this.status();
        this.draw();
    }
    dispose() {
        this.stop();
        this.mixer.uncacheRoot(this.root);
        document.removeEventListener("visibilitychange", this.visibility);
    }
}

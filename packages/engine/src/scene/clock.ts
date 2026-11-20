// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The scene's animation clock: every tween the field runs is a job stepped by
 * frame time. Scene jobs (bodies, effects, the action camera) run on frame
 * time times `timeScale`, so a replay at 2x plays every animation at 2x and a
 * scale of 0 holds them where they are; real jobs (the player's own camera
 * moves) always run on frame time. A change of scale mid-animation is clean:
 * each job integrates the time it is given, frame by frame.
 *
 * No three.js here, so the rules of the clock are tested in node.
 */

/** One step of an animation; true once it is done. */
export type Job = (dt: number) => boolean;

export class SceneClock {
  /** Scene time per frame time: 1 as played, 0 holds every scene job. */
  timeScale = 1;
  private jobs: Job[] = [];
  private realJobs: Job[] = [];

  /** Scene jobs are pending and would move this frame (a held clock moves nothing). */
  get moving(): boolean {
    return (this.jobs.length > 0 && this.timeScale > 0) || this.realJobs.length > 0;
  }

  /** Scene jobs pending, moving or held. */
  get pending(): number {
    return this.jobs.length;
  }

  /** Frame time as the scene sees it. */
  scaled(elapsed: number): number {
    return elapsed * this.timeScale;
  }

  /**
   * Run `fn` from 0 to 1 over `seconds` of scene time (`real`: of frame time),
   * eased unless `smooth` is false; resolves at 1.
   */
  tween(seconds: number, fn: (t: number) => void, smooth = true, real = false): Promise<void> {
    return new Promise<void>((resolve) => {
      let elapsed = 0;
      (real ? this.realJobs : this.jobs).push((dt) => {
        elapsed += dt;
        const t = seconds > 0 ? Math.min(1, elapsed / seconds) : 1;
        fn(smooth ? t * t * (3 - 2 * t) : t);
        if (t < 1) return false;
        resolve();
        return true;
      });
    });
  }

  /** One frame: `elapsed` seconds of frame time. */
  step(elapsed: number) {
    const dt = this.scaled(elapsed);
    if (dt > 0) this.jobs = this.jobs.filter((job) => !job(dt));
    if (this.realJobs.length) this.realJobs = this.realJobs.filter((job) => !job(elapsed));
  }

  /** Bring every scene job pending now to its end at once; the ones they start wait for the next call. */
  flush() {
    const jobs = this.jobs;
    this.jobs = [];
    for (const job of jobs) if (!job(1e6)) this.jobs.push(job);
  }

  /**
   * Run scene animation to its end now, whatever the scale, until `done`
   * settles and nothing is left: what an animation starts once a step ends
   * (the next clip, the camera's return) is flushed too. `yieldTo` lets those
   * continuations run between flushes.
   */
  async finish(done: Promise<unknown>, yieldTo: () => Promise<void> = () => new Promise((r) => setTimeout(r, 0))) {
    let settled = false;
    void done.then(
      () => (settled = true),
      () => (settled = true),
    );
    for (let i = 0; i < 1000; i++) {
      this.flush();
      await yieldTo();
      if (settled && !this.jobs.length) return;
    }
  }
}

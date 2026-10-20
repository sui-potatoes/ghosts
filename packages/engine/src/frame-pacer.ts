/** Keep an absolute deadline so a late vsync does not permanently shift every later frame. */
export class FramePacer {
  private next = 0;
  private last: number | null = null;
  private rate = 0;
  reset() {
    this.next = 0;
    this.last = null;
    this.rate = 0;
  }
  step(now: number, rate: number): number | null {
    if (rate !== this.rate) {
      this.next = now;
      this.rate = rate;
    }
    if (now + 0.5 < this.next) return null;
    const dt =
      this.last === null ? 1 / rate : Math.min((now - this.last) / 1000, 0.1);
    const interval = 1000 / rate;
    this.next += interval;
    if (this.next <= now)
      this.next += (Math.floor((now - this.next) / interval) + 1) * interval;
    this.last = now;
    return dt;
  }
}

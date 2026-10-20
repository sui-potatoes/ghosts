import type * as T from "three";

type GpuTimer = { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number };

/**
 * Frame metrics written to the viewport's data attributes for QA: draw calls,
 * triangles and textures always; CPU, GPU and FPS percentiles with `?profile`.
 */
export class RenderProfiler {
  private readonly enabled = new URLSearchParams(location.search).has("profile");
  private readonly gpu: GpuTimer | null = null;
  private query: WebGLQuery | null = null;
  private measuring = false;
  private gpuSamples: number[] = [];
  private samples: number[][] = [];
  private lastProfile = 0;
  private lastMetrics = 0;
  private frames = 0;
  private renderStart = 0;
  private readonly gl: WebGL2RenderingContext;

  constructor(
    private readonly renderer: T.WebGLRenderer,
    private readonly host: HTMLElement,
  ) {
    this.gl = renderer.getContext() as WebGL2RenderingContext;
    if (this.enabled) this.gpu = this.gl.getExtension("EXT_disjoint_timer_query_webgl2");
  }

  /** Call right before `renderer.render`. */
  begin() {
    this.renderer.info.autoReset = false;
    this.renderer.info.reset();
    const { gl, gpu } = this;
    this.measuring = false;
    if (gpu) {
      if (this.query && gl.getQueryParameter(this.query, gl.QUERY_RESULT_AVAILABLE)) {
        if (!gl.getParameter(gpu.GPU_DISJOINT_EXT)) {
          this.gpuSamples.push(gl.getQueryParameter(this.query, gl.QUERY_RESULT) / 1e6);
          if (this.gpuSamples.length > 180) this.gpuSamples.shift();
        }
        gl.deleteQuery(this.query);
        this.query = null;
      }
      if (!this.query) {
        this.query = gl.createQuery();
        gl.beginQuery(gpu.TIME_ELAPSED_EXT, this.query);
        this.measuring = true;
      }
    }
    this.renderStart = performance.now();
  }

  /** Call right after `renderer.render`; `elapsed` is the frame step, `cpuStart` when the frame began. */
  end(now: number, elapsed: number, cpuStart: number, mode: string) {
    if (this.measuring) this.gl.endQuery(this.gpu!.TIME_ELAPSED_EXT);
    const { host, renderer } = this;
    if (this.enabled) this.profile(now, elapsed, cpuStart);
    host.dataset.renderFrames = String(++this.frames);
    if (now - this.lastMetrics > 250) {
      this.lastMetrics = now;
      host.dataset.renderMode = mode;
      host.dataset.renderCalls = String(renderer.info.render.calls);
      host.dataset.renderTriangles = String(renderer.info.render.triangles);
      host.dataset.renderTextures = String(renderer.info.memory.textures);
    }
  }

  private profile(now: number, elapsed: number, cpuStart: number) {
    const samples = this.samples;
    samples.push([elapsed * 1000, this.renderStart - cpuStart, performance.now() - this.renderStart]);
    if (samples.length > 180) samples.shift();
    if (now - this.lastProfile <= 500) return;
    this.lastProfile = now;
    const average = (i: number) => samples.reduce((a, v) => a + v[i], 0) / samples.length;
    const p95 = (i: number) =>
      samples.map((v) => v[i]).sort((a, b) => a - b)[Math.floor((samples.length - 1) * 0.95)];
    const gpu = this.gpuSamples;
    this.host.dataset.profile = JSON.stringify({
      gpuMs: gpu.length ? +(gpu.reduce((a, v) => a + v, 0) / gpu.length).toFixed(2) : null,
      samples: samples.length,
      fps: +(1000 / average(0)).toFixed(1),
      frameP95: +p95(0).toFixed(1),
      updateMs: +average(1).toFixed(2),
      renderSubmitMs: +average(2).toFixed(2),
      cpuP95: +(p95(1) + p95(2)).toFixed(2),
    });
  }

  dispose() {
    if (this.query) this.gl.deleteQuery(this.query);
  }
}

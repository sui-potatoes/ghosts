// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Ground smoke behind the settings menu, rendered on a 2D canvas: soft lumpy
 * puffs drifting on a slow wind, swaying, swelling and dissolving like gas.
 * The host element places and masks the canvas (bottom of the screen, fading
 * upward); this module only draws into it. Purely decorative: no input, and
 * reduce-motion freezes the field on a single frame.
 */

const PUFFS = 22;
const WIND = -14; // px/s, a slow leftward draught
const SPRITES = 3;
const MAX_DPR = 1.5;

type Puff = {
    x: number;
    y: number;
    r: number;
    vx: number;
    vy: number;
    rot: number;
    spin: number;
    /** Relative growth per second: smoke expands as it rises. */
    grow: number;
    swayAmp: number;
    swayFreq: number;
    phase: number;
    alpha: number;
    life: number;
    ttl: number;
    sprite: number;
};

/** A soft lumpy puff: overlapping offset gradients, not a perfect disc. */
function makeSprite(): HTMLCanvasElement {
    const size = 256;
    const sprite = document.createElement("canvas");
    sprite.width = sprite.height = size;
    const g = sprite.getContext("2d")!;
    for (let i = 0; i < 4; i++) {
        const cx = size / 2 + (Math.random() - 0.5) * size * 0.35;
        const cy = size / 2 + (Math.random() - 0.5) * size * 0.35;
        const r = size * (0.2 + Math.random() * 0.2);
        const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, "rgb(255 255 255 / 0.22)");
        grad.addColorStop(0.55, "rgb(255 255 255 / 0.08)");
        grad.addColorStop(1, "rgb(255 255 255 / 0)");
        g.fillStyle = grad;
        g.fillRect(0, 0, size, size);
    }
    return sprite;
}

function spawn(w: number, h: number, initial: boolean): Puff {
    const r = (0.14 + Math.random() * 0.2) * Math.max(w, 320);
    const ttl = 16 + Math.random() * 14;
    return {
        // New puffs enter from the right so the wind carries them across.
        x: initial ? Math.random() * (w + r * 2) - r : w + r * 0.6,
        y: h * (0.45 + Math.random() * 0.65),
        r,
        vx: WIND * (0.6 + Math.random() * 0.8),
        vy: -(4 + Math.random() * 9),
        rot: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 0.1,
        grow: 0.012 + Math.random() * 0.02,
        swayAmp: 8 + Math.random() * 18,
        swayFreq: 0.15 + Math.random() * 0.25,
        phase: Math.random() * Math.PI * 2,
        alpha: 0.05 + Math.random() * 0.05,
        life: initial ? Math.random() * ttl : 0,
        ttl,
        sprite: Math.floor(Math.random() * SPRITES),
    };
}

/** Trapezoid fade: in over the first quarter of life, out over the last third. */
function fade(t: number): number {
    return Math.max(0, Math.min(1, t / 0.25, (1 - t) / 0.35));
}

/** Animate smoke in `canvas` until the returned stop function is called. */
export function startSmoke(canvas: HTMLCanvasElement): () => void {
    const ctx = canvas.getContext("2d");
    if (!ctx) return () => {};

    const sprites = Array.from({ length: SPRITES }, makeSprite);
    let puffs: Puff[] = [];
    let raf = 0;
    let timer = 0;
    let stopped = false;
    let staticFrame = false;
    let lastTime = 0;
    let prevW = 0;
    let prevH = 0;

    /** Follow the element's size (and the zoom level); keep the field. */
    function resize() {
        const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        if (!w || !h) return;
        const targetW = Math.round(w * dpr);
        const targetH = Math.round(h * dpr);
        if (targetW === canvas.width && targetH === canvas.height && puffs.length) return;
        canvas.width = targetW;
        canvas.height = targetH;
        ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (!puffs.length) {
            puffs = Array.from({ length: PUFFS }, () => spawn(w, h, true));
        } else if (prevW && prevH) {
            // Scale the existing field so a resize never pops the smoke.
            const sx = w / prevW;
            const sy = h / prevH;
            for (const p of puffs) {
                p.x *= sx;
                p.y *= sy;
                p.r *= sx;
            }
        }
        prevW = w;
        prevH = h;
        staticFrame = false;
    }

    function draw(now: number) {
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        ctx!.clearRect(0, 0, w, h);
        // Additive blending lets overlapping puffs thicken into fog.
        ctx!.globalCompositeOperation = "lighter";
        for (const p of puffs) {
            const alpha = p.alpha * fade(p.life / p.ttl);
            if (alpha <= 0) continue;
            const sway = Math.sin(now * p.swayFreq + p.phase) * p.swayAmp;
            ctx!.save();
            ctx!.globalAlpha = alpha;
            ctx!.translate(p.x + sway, p.y);
            ctx!.rotate(p.rot);
            ctx!.drawImage(sprites[p.sprite], -p.r, -p.r, p.r * 2, p.r * 2);
            ctx!.restore();
        }
        ctx!.globalCompositeOperation = "source-over";
    }

    function update(dt: number) {
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        for (let i = 0; i < puffs.length; i++) {
            const p = puffs[i];
            p.life += dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.r *= 1 + p.grow * dt;
            p.rot += p.spin * dt;
            const gone = p.life > p.ttl || p.x < -p.r * 1.5 || p.y < -p.r;
            if (gone) puffs[i] = spawn(w, h, false);
        }
    }

    function tick(ms: number) {
        if (stopped) return;
        const reduced = document.documentElement.dataset.reduceMotion === "on";
        if (reduced) {
            // Hold a single frame; poll gently for the setting to flip back.
            if (!staticFrame) {
                draw(ms / 1000);
                staticFrame = true;
            }
            timer = window.setTimeout(() => {
                timer = 0;
                raf = requestAnimationFrame(tick);
            }, 500);
            return;
        }
        staticFrame = false;
        const now = ms / 1000;
        const dt = Math.min(0.1, lastTime ? now - lastTime : 0.016);
        lastTime = now;
        update(dt);
        draw(now);
        raf = requestAnimationFrame(tick);
    }

    // The observer follows the element (window resizes included); the window
    // listener additionally catches zoom-level changes, which alter the
    // device pixel ratio without resizing the element.
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    window.addEventListener("resize", resize);
    resize();
    raf = requestAnimationFrame(tick);

    return () => {
        stopped = true;
        observer.disconnect();
        window.removeEventListener("resize", resize);
        cancelAnimationFrame(raf);
        clearTimeout(timer);
    };
}

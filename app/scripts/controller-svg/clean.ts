// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Cleans the hand-drawn Inkscape controller diagram into the asset the
 * settings Controller panel renders.
 *
 *     node --experimental-strip-types scripts/controller-svg/clean.ts
 *
 * Input:  ../controller.svg (repo root; override with the first argument).
 * Output: src/settings/controller-diagram.svg
 *
 * What it does, in order:
 *  - drops the embedded tracing PNG, <sodipodi:namedview>, empty <defs>,
 *    comments, and every inkscape:/sodipodi: attribute and namespace;
 *  - renames each control group from its Inkscape label to a stable id
 *    (ctl-a, ctl-rt, …) carrying the engine's PadButton name in data-pad;
 *  - wraps the four d-pad arms in one ctl-dpad group and each stick's cap
 *    ellipses in a mover group (data-stick) the panel translates;
 *  - bakes transforms: rotated ellipses become absolute-coordinate paths,
 *    and all path data is rewritten as absolute commands, rounded;
 *  - replaces per-element style soup with two classes (ctl-pointer for
 *    leader lines, ctl-symbol for glyph art, ctl-fill/ctl-fill-dark for the
 *    stick caps) plus a stroke-width attribute — colors come from CSS;
 *  - finds the outer end of each group's leader line and stores it on the
 *    group as data-label-x/y/anchor, where the panel hangs action labels.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const input = resolve(process.argv[2] ?? join(here, "../../../controller.svg"));
const output = join(here, "../../src/settings/controller-diagram.svg");

// ---------------------------------------------------------------------------
// A minimal XML tree, enough for Inkscape's regular output.

interface El {
    tag: string;
    attrs: Map<string, string>;
    children: El[];
}

function parseXml(src: string): El {
    // Strip the declaration and comments; the tags that remain are regular.
    src = src.replace(/<\?xml[^?]*\?>/g, "").replace(/<!--[\s\S]*?-->/g, "");
    const tagRe = /<(\/?)([\w:-]+)((?:\s+[\w:.-]+\s*=\s*"[^"]*")*)\s*(\/?)>/g;
    const attrRe = /([\w:.-]+)\s*=\s*"([^"]*)"/g;
    const root: El = { tag: "#root", attrs: new Map(), children: [] };
    const stack = [root];
    for (let m = tagRe.exec(src); m; m = tagRe.exec(src)) {
        const [, close, tag, rawAttrs, selfClose] = m;
        if (close) {
            if (stack.pop()?.tag !== tag) throw new Error(`mismatched </${tag}>`);
            continue;
        }
        const attrs = new Map<string, string>();
        for (let a = attrRe.exec(rawAttrs); a; a = attrRe.exec(rawAttrs)) attrs.set(a[1], a[2]);
        const el: El = { tag, attrs, children: [] };
        stack[stack.length - 1].children.push(el);
        if (!selfClose) stack.push(el);
    }
    if (stack.length !== 1) throw new Error("unclosed tags");
    return root.children[0];
}

// ---------------------------------------------------------------------------
// Numbers and path data.

/** Round to 2 decimals and drop trailing zeros: 0.04 viewBox-units of slack. */
const fmt = (v: number): string => {
    const s = v.toFixed(2).replace(/\.?0+$/, "");
    return s === "-0" ? "0" : s;
};

/** Rewrites path data as absolute commands and collects every on-path point. */
function absolutizePath(d: string): { d: string; points: [number, number][] } {
    let i = 0;
    const next = (): string | null => {
        while (i < d.length && /[\s,]/.test(d[i])) i++;
        if (i >= d.length) return null;
        if (/[a-zA-Z]/.test(d[i])) return d[i++];
        const m = /^[-+]?(\d*\.\d+|\d+\.?)([eE][-+]?\d+)?/.exec(d.slice(i));
        if (!m) throw new Error(`bad path data at ${i}: …${d.slice(i, i + 20)}`);
        i += m[0].length;
        return m[0];
    };
    const num = (): number => {
        const t = next();
        if (t === null || (t.length === 1 && /[a-zA-Z]/.test(t)))
            throw new Error(`expected number, got ${t}`);
        return parseFloat(t);
    };
    const flag = (): number => {
        while (i < d.length && /[\s,]/.test(d[i])) i++;
        const c = d[i++];
        if (c !== "0" && c !== "1") throw new Error(`expected arc flag, got ${c}`);
        return c === "1" ? 1 : 0;
    };

    let cx = 0,
        cy = 0, // current point
        sx = 0,
        sy = 0; // subpath start
    let cmd = "";
    const out: string[] = [];
    const points: [number, number][] = [];
    const point = (x: number, y: number) => {
        cx = x;
        cy = y;
        points.push([x, y]);
    };

    for (;;) {
        while (i < d.length && /[\s,]/.test(d[i])) i++;
        if (i >= d.length) break;
        if (/[a-zA-Z]/.test(d[i])) cmd = d[i++];
        // else: implicit repeat of the previous command (m becomes l per spec)
        else if (cmd === "m") cmd = "l";
        else if (cmd === "M") cmd = "L";
        const rel = cmd === cmd.toLowerCase();
        const dx = rel ? cx : 0;
        const dy = rel ? cy : 0;
        switch (cmd.toLowerCase()) {
            case "m": {
                point(num() + dx, num() + dy);
                sx = cx;
                sy = cy;
                out.push(`M ${fmt(cx)} ${fmt(cy)}`);
                break;
            }
            case "l": {
                point(num() + dx, num() + dy);
                out.push(`L ${fmt(cx)} ${fmt(cy)}`);
                break;
            }
            case "h": {
                point(num() + dx, cy);
                out.push(`L ${fmt(cx)} ${fmt(cy)}`);
                break;
            }
            case "v": {
                point(cx, num() + dy);
                out.push(`L ${fmt(cx)} ${fmt(cy)}`);
                break;
            }
            case "c": {
                const x1 = num() + dx,
                    y1 = num() + dy,
                    x2 = num() + dx,
                    y2 = num() + dy;
                point(num() + dx, num() + dy);
                out.push(`C ${fmt(x1)} ${fmt(y1)} ${fmt(x2)} ${fmt(y2)} ${fmt(cx)} ${fmt(cy)}`);
                break;
            }
            case "s": {
                const x2 = num() + dx,
                    y2 = num() + dy;
                point(num() + dx, num() + dy);
                out.push(`S ${fmt(x2)} ${fmt(y2)} ${fmt(cx)} ${fmt(cy)}`);
                break;
            }
            case "q": {
                const x1 = num() + dx,
                    y1 = num() + dy;
                point(num() + dx, num() + dy);
                out.push(`Q ${fmt(x1)} ${fmt(y1)} ${fmt(cx)} ${fmt(cy)}`);
                break;
            }
            case "t": {
                point(num() + dx, num() + dy);
                out.push(`T ${fmt(cx)} ${fmt(cy)}`);
                break;
            }
            case "a": {
                const rx = num(),
                    ry = num(),
                    rot = num(),
                    large = flag(),
                    sweep = flag();
                point(num() + dx, num() + dy);
                out.push(
                    `A ${fmt(rx)} ${fmt(ry)} ${fmt(rot)} ${large} ${sweep} ${fmt(cx)} ${fmt(cy)}`,
                );
                break;
            }
            case "z": {
                point(sx, sy);
                out.push("Z");
                break;
            }
            default:
                throw new Error(`unsupported path command ${cmd}`);
        }
    }
    return { d: out.join(" "), points };
}

/** A rotated ellipse becomes a two-arc path at its real coordinates. */
function bakeEllipse(attrs: Map<string, string>): Map<string, string> | null {
    const tr = attrs.get("transform");
    if (!tr) return null;
    const rot = /^\s*rotate\(\s*([-\d.]+)\s*\)\s*$/.exec(tr);
    if (!rot) throw new Error(`unhandled ellipse transform: ${tr}`);
    const a = (parseFloat(rot[1]) * Math.PI) / 180;
    const cos = Math.cos(a),
        sin = Math.sin(a);
    const cx = parseFloat(attrs.get("cx") ?? "0");
    const cy = parseFloat(attrs.get("cy") ?? "0");
    const rx = parseFloat(attrs.get("rx") ?? "0");
    const ry = parseFloat(attrs.get("ry") ?? "0");
    const ex = cx * cos - cy * sin; // the rotated center
    const ey = cx * sin + cy * cos;
    const deg = fmt(parseFloat(rot[1]));
    const p1 = [ex + rx * cos, ey + rx * sin];
    const p2 = [ex - rx * cos, ey - rx * sin];
    const arc = (x: number, y: number) => `A ${fmt(rx)} ${fmt(ry)} ${deg} 1 0 ${fmt(x)} ${fmt(y)}`;
    const d = `M ${fmt(p1[0])} ${fmt(p1[1])} ${arc(p2[0], p2[1])} ${arc(p1[0], p1[1])} Z`;
    const out = new Map(attrs);
    out.delete("transform");
    out.delete("cx");
    out.delete("cy");
    out.delete("rx");
    out.delete("ry");
    out.set("d", d);
    return out;
}

// ---------------------------------------------------------------------------
// The semantic naming scheme, keyed by the artist's Inkscape labels.

const GROUPS: Record<string, { id: string; pad?: string }> = {
    OUTLINE: { id: "ctl-body" },
    TRACKPAD: { id: "ctl-touchpad" },
    CROSS: { id: "ctl-a", pad: "a" },
    CIRCLE: { id: "ctl-b", pad: "b" },
    SQUARE: { id: "ctl-x", pad: "x" },
    TRIANGLE: { id: "ctl-y", pad: "y" },
    L1: { id: "ctl-lb", pad: "lb" },
    R1: { id: "ctl-rb", pad: "rb" },
    L2: { id: "ctl-lt", pad: "lt" },
    R2: { id: "ctl-rt", pad: "rt" },
    OPTIONS: { id: "ctl-start", pad: "start" },
    "OPTIONS-LEFT": { id: "ctl-select", pad: "select" },
    "PAD-UP": { id: "ctl-up", pad: "up" },
    "PAD-RIGHT": { id: "ctl-right", pad: "right" },
    "PAD-BOTTOM": { id: "ctl-down", pad: "down" },
    "PAD-LEFT": { id: "ctl-left", pad: "left" },
    "L-STICK": { id: "ctl-stick-left", pad: "l3" },
    "R-STICK": { id: "ctl-stick-right", pad: "r3" },
};

const DPAD = new Set(["ctl-up", "ctl-right", "ctl-down", "ctl-left"]);
const STICKS: Record<string, string> = { "ctl-stick-left": "0", "ctl-stick-right": "1" };

const label = (el: El) => el.attrs.get("inkscape:label") ?? "";

/**
 * What a child draws: the leader line to its label row, glyph art, or part
 * of the control's shape. Two sloppy spots in the source need overrides: in
 * SQUARE the leader line is labeled "square" (the glyph is the bare rect),
 * and L2's two paths carry no labels at all (the 0.3-width one leads out).
 */
function roleOf(
    group: string,
    childLabel: string,
    el: El,
    width?: string,
): "pointer" | "symbol" | "" {
    if (/^pointer/.test(childLabel)) return "pointer";
    if (group === "SQUARE" && childLabel === "square") return "pointer";
    if (group === "L2" && el.tag === "path" && width === "0.3") return "pointer";
    if (/^symbol/.test(childLabel)) return "symbol";
    const faces = new Set(["TRIANGLE", "CIRCLE", "CROSS", "SQUARE"]);
    if (faces.has(group) && childLabel !== group) return "symbol";
    return "";
}

// ---------------------------------------------------------------------------
// Load, restructure, serialize.

const raw = readFileSync(input, "utf8");
const svg = parseXml(raw);
if (svg.tag !== "svg") throw new Error(`expected <svg>, got <${svg.tag}>`);

const layer = svg.children.find((c) => c.tag === "g" && label(c) === "Layer 1");
if (!layer) throw new Error("no 'Layer 1' group");

const warnings: string[] = [];
let kept = 0;

/** style="…" → the few properties we keep, as classes and attributes. */
function restyle(el: El, role: string, props: Map<string, string>) {
    el.attrs.delete("style");
    const classes: string[] = [];
    if (role === "pointer") classes.push("ctl-pointer");
    else if (role === "symbol") classes.push("ctl-symbol");
    const fill = props.get("fill") ?? "none";
    if (fill === "#ffffff") classes.push("ctl-fill");
    else if (fill === "#000000") classes.push("ctl-fill-dark");
    if (classes.length) el.attrs.set("class", classes.join(" "));
    const w = props.get("stroke-width");
    if (w) el.attrs.set("stroke-width", fmt(parseFloat(w)));
    if (props.get("display") === "none") el.attrs.set("display", "none");
    const dash = props.get("stroke-dasharray");
    if (dash && dash !== "none") el.attrs.set("stroke-dasharray", dash);
}

/** One drawing element: bake transforms, absolutize, restyle, rename. */
function cleanShape(el: El, groupLabel: string, groupId: string, n: number): El | null {
    if (el.tag === "image") return null;
    const childLabel = label(el);
    const props = new Map(
        (el.attrs.get("style") ?? "")
            .split(";")
            .filter(Boolean)
            .map((p) => p.split(":").map((s) => s.trim()) as [string, string]),
    );
    const role = roleOf(groupLabel, childLabel, el, props.get("stroke-width"));
    for (const k of [...el.attrs.keys()])
        if (/^(inkscape|sodipodi|xlink|xml):/.test(k)) el.attrs.delete(k);
    if (el.tag === "ellipse") {
        const baked = bakeEllipse(el.attrs);
        if (baked) {
            el.tag = "path";
            el.attrs = baked;
        } else {
            for (const k of ["cx", "cy", "rx", "ry"] as const)
                el.attrs.set(k, fmt(parseFloat(el.attrs.get(k) ?? "0")));
        }
    } else if (el.attrs.get("transform")) {
        throw new Error(`unbaked transform on <${el.tag} id=${el.attrs.get("id")}>`);
    }
    if (el.tag === "path") {
        const abs = absolutizePath(el.attrs.get("d") ?? "");
        el.attrs.set("d", abs.d);
        (el as El & { points?: [number, number][] }).points = abs.points;
    }
    if (el.tag === "rect")
        for (const k of ["x", "y", "width", "height"] as const) {
            const v = el.attrs.get(k);
            if (v) el.attrs.set(k, fmt(parseFloat(v)));
        }
    restyle(el, role, props);
    const suffix =
        role ||
        (childLabel && childLabel !== groupLabel
            ? childLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")
            : "") ||
        (childLabel === groupLabel ? "button" : `${n}`);
    el.attrs.set("id", `${groupId}-${suffix}`);
    kept++;
    return el;
}

/** The ellipse centers / path points of a group's non-pointer children. */
function shapePoints(els: El[]): [number, number][] {
    const pts: [number, number][] = [];
    for (const el of els) {
        if (el.attrs.get("class")?.includes("ctl-pointer")) continue;
        const p = (el as El & { points?: [number, number][] }).points;
        if (p) pts.push(...p);
        else if (el.tag === "ellipse")
            pts.push([parseFloat(el.attrs.get("cx")!), parseFloat(el.attrs.get("cy")!)]);
        else if (el.tag === "rect")
            pts.push([parseFloat(el.attrs.get("x")!), parseFloat(el.attrs.get("y")!)]);
    }
    return pts;
}

/** Hang the leader line's outer end on the group as the label anchor. */
function anchorFromPointer(group: El, shapes: El[]) {
    const pointer = shapes.find((s) => s.attrs.get("class")?.includes("ctl-pointer"));
    const pts = (pointer as (El & { points?: [number, number][] }) | undefined)?.points;
    if (!pointer || !pts?.length) {
        warnings.push(`${group.attrs.get("id")}: no leader line, no label anchor`);
        return;
    }
    const body = shapePoints(shapes);
    if (!body.length) return;
    const cx = body.reduce((s, p) => s + p[0], 0) / body.length;
    const cy = body.reduce((s, p) => s + p[1], 0) / body.length;
    const d2 = (p: [number, number]) => (p[0] - cx) ** 2 + (p[1] - cy) ** 2;
    const [first, last] = [pts[0], pts[pts.length - 1]];
    const end = d2(first) > d2(last) ? first : last;
    group.attrs.set("data-label-x", fmt(end[0]));
    group.attrs.set("data-label-y", fmt(end[1]));
    group.attrs.set(
        "data-label-anchor",
        Math.abs(end[0] - cx) < 2 ? "middle" : end[0] < cx ? "end" : "start",
    );
    if (group.attrs.get("data-label-anchor") === "middle")
        group.attrs.set("data-label-side", end[1] < cy ? "above" : "below");
}

const groups: El[] = [];
for (const child of layer.children) {
    if (child.tag === "image") continue;
    if (child.tag !== "g") {
        warnings.push(`stray <${child.tag}> at layer level dropped`);
        continue;
    }
    const name = label(child);
    const spec = GROUPS[name];
    if (!spec) {
        warnings.push(`unknown group label "${name}" kept verbatim as ${child.attrs.get("id")}`);
    }
    const id = spec?.id ?? `ctl-${(child.attrs.get("id") ?? "g").toLowerCase()}`;
    const display = /display\s*:\s*none/.test(child.attrs.get("style") ?? "");
    const shapes = child.children
        .map((el, n) => cleanShape(el, name, id, n + 1))
        .filter((el): el is El => el !== null);
    // Two shapes of one role in a group would collide; number the extras.
    const seen = new Map<string, number>();
    for (const s of shapes) {
        const sid = s.attrs.get("id")!;
        const n = (seen.get(sid) ?? 0) + 1;
        seen.set(sid, n);
        if (n > 1) s.attrs.set("id", `${sid}-${n}`);
    }
    const attrs = new Map<string, string>([["id", id]]);
    if (spec?.pad && !STICKS[id]) attrs.set("data-pad", spec.pad);
    if (display) attrs.set("display", "none");
    const group: El = { tag: "g", attrs, children: shapes };
    if (STICKS[id]) {
        // The cap (every non-pointer shape) moves with the real stick and
        // lights up on L3/R3; the leader line stays put.
        const cap: El = {
            tag: "g",
            attrs: new Map([
                ["id", `${id}-cap`],
                ["data-stick", STICKS[id]],
                ["data-pad", spec!.pad!],
            ]),
            children: shapes.filter((s) => !s.attrs.get("class")?.includes("ctl-pointer")),
        };
        group.children = [cap, ...shapes.filter((s) => !cap.children.includes(s))];
    }
    if (spec?.pad || STICKS[id]) anchorFromPointer(group, shapes);
    groups.push(group);
}

// The four d-pad arms live under one addressable group.
const first = groups.findIndex((g) => DPAD.has(g.attrs.get("id")!));
const arms = groups.filter((g) => DPAD.has(g.attrs.get("id")!));
if (first >= 0 && arms.length === 4) {
    const dpad: El = {
        tag: "g",
        attrs: new Map([
            ["id", "ctl-dpad"],
            ["data-group", "dpad"],
        ]),
        children: arms,
    };
    const rest = groups.filter((g) => !DPAD.has(g.attrs.get("id")!));
    rest.splice(first, 0, dpad);
    groups.length = 0;
    groups.push(...rest);
} else warnings.push("d-pad arms not found; left unwrapped");

const viewBox = svg.attrs.get("viewBox") ?? "0 0 100 100";
const out: El = {
    tag: "svg",
    attrs: new Map([
        ["xmlns", "http://www.w3.org/2000/svg"],
        ["viewBox", viewBox],
    ]),
    children: groups,
};

function serialize(el: El, depth: number): string {
    const pad = "    ".repeat(depth);
    const attrs = [...el.attrs].map(([k, v]) => ` ${k}="${v}"`).join("");
    if (!el.children.length) return `${pad}<${el.tag}${attrs} />`;
    const inner = el.children.map((c) => serialize(c, depth + 1)).join("\n");
    return `${pad}<${el.tag}${attrs}>\n${inner}\n${pad}</${el.tag}>`;
}

const text = serialize(out, 0) + "\n";
writeFileSync(output, text);

console.log(`in:  ${raw.length} bytes (${input})`);
console.log(`out: ${text.length} bytes (${output})`);
console.log(`     ${groups.length} top-level groups, ${kept} shapes`);
for (const g of groups) {
    const id = g.attrs.get("id");
    const a = g.attrs.get("data-label-x")
        ? ` label @ (${g.attrs.get("data-label-x")}, ${g.attrs.get("data-label-y")}) ${g.attrs.get("data-label-anchor")}`
        : "";
    const pads = [g, ...g.children]
        .map((c) => c.attrs.get("data-pad"))
        .filter(Boolean)
        .join(",");
    console.log(`     ${id}${pads ? ` [${pads}]` : ""}${a}`);
}
for (const w of warnings) console.warn(`warn: ${w}`);

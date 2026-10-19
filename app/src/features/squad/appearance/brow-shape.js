// Small, face-fitted edits to native brow cards. All coordinates are in metres.
// A front-surface grid avoids raycasting the entire portrait for each slider tick.
export function frontSurface(positions, indices, cell = 0.008) {
    const bins = new Map();
    for (let i = 0; i < indices.length; i += 3) {
        const a = indices[i] * 3,
            b = indices[i + 1] * 3,
            c = indices[i + 2] * 3;
        const x0 = positions[a],
            y0 = positions[a + 1],
            x1 = positions[b],
            y1 = positions[b + 1],
            x2 = positions[c],
            y2 = positions[c + 1];
        const det = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
        if (Math.abs(det) < 1e-12) continue;
        const tri = {
            x0,
            y0,
            x1,
            y1,
            x2,
            y2,
            z0: positions[a + 2],
            z1: positions[b + 2],
            z2: positions[c + 2],
            det,
        };
        for (
            let x = Math.floor(Math.min(x0, x1, x2) / cell);
            x <= Math.floor(Math.max(x0, x1, x2) / cell);
            x++
        )
            for (
                let y = Math.floor(Math.min(y0, y1, y2) / cell);
                y <= Math.floor(Math.max(y0, y1, y2) / cell);
                y++
            ) {
                const key = x + "," + y;
                if (!bins.has(key)) bins.set(key, []);
                bins.get(key).push(tri);
            }
    }
    return (x, y) => {
        let z = -Infinity;
        for (const t of bins.get(Math.floor(x / cell) + "," + Math.floor(y / cell)) ?? []) {
            const a = ((t.y1 - t.y2) * (x - t.x2) + (t.x2 - t.x1) * (y - t.y2)) / t.det,
                b = ((t.y2 - t.y0) * (x - t.x2) + (t.x0 - t.x2) * (y - t.y2)) / t.det,
                c = 1 - a - b;
            if (a >= -1e-5 && b >= -1e-5 && c >= -1e-5)
                z = Math.max(z, a * t.z0 + b * t.z1 + c * t.z2);
        }
        return Number.isFinite(z) ? z : null;
    };
}
export function shapeBrow(source, params, surface) {
    const out = source.slice(),
        { browThickness = 0, browLength = 0, browArch = 0, browTail = 0 } = params;
    if (!browThickness && !browLength && !browArch && !browTail) return out;
    for (const side of [-1, 1]) {
        const vertices = [];
        for (let i = 0; i < source.length; i += 3)
            if (Math.sign(source[i]) === side) vertices.push(i);
        if (!vertices.length) continue;
        const inner = Math.min(...vertices.map((i) => Math.abs(source[i]))),
            outer = Math.max(...vertices.map((i) => Math.abs(source[i]))),
            width = outer - inner;
        if (width < 1e-6) continue;
        for (const i of vertices) {
            const x = Math.abs(source[i]),
                t = (x - inner) / width;
            const strip = vertices.filter((j) => Math.abs(Math.abs(source[j]) - x) < 0.0035);
            const center =
                (Math.min(...strip.map((j) => source[j + 1])) +
                    Math.max(...strip.map((j) => source[j + 1]))) /
                2;
            const nx = side * (inner + (x - inner) * (1 + browLength * 0.16));
            const ny =
                center +
                (source[i + 1] - center) * (1 + browThickness * 0.42) +
                browArch * 0.0035 * Math.sin(Math.PI * t) +
                browTail * 0.004 * t * t * t;
            const oldSurface = surface(source[i], source[i + 1]),
                newSurface = surface(nx, ny);
            // Keep the native card's skin clearance. Missing surface => retain native fit.
            if (oldSurface === null || newSurface === null) continue;
            out[i] = nx;
            out[i + 1] = ny;
            out[i + 2] = source[i + 2] + newSurface - oldSurface;
        }
    }
    return out;
}

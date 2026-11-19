// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/** Small statistics for the balance simulation: intervals and a logistic fit. */

/** Wilson 95% interval for `wins` (draws count half) out of `n`, in percent. */
export function wilson(wins: number, n: number): [number, number] {
    if (n === 0) return [0, 100];
    const z = 1.96;
    const p = wins / n;
    const centre = (p + (z * z) / (2 * n)) / (1 + (z * z) / n);
    const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n);
    return [100 * (centre - half), 100 * (centre + half)];
}

export const pct = (wins: number, n: number) => (n ? (100 * wins) / n : 0);

/** "54.1% [51.0, 57.2]". */
export function rate(wins: number, n: number): string {
    const [lo, hi] = wilson(wins, n);
    return `${pct(wins, n).toFixed(1)}% [${lo.toFixed(1)}, ${hi.toFixed(1)}]`;
}

/** Solve `a x = b` by Gaussian elimination with partial pivoting. */
function solve(a: number[][], b: number[]): number[] {
    const n = b.length;
    const m = a.map((row, i) => [...row, b[i]]);
    for (let c = 0; c < n; c++) {
        let p = c;
        for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
        [m[c], m[p]] = [m[p], m[c]];
        for (let r = 0; r < n; r++) {
            if (r === c) continue;
            const f = m[r][c] / m[c][c];
            for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k];
        }
    }
    return m.map((row, i) => row[n] / row[i]);
}

function invert(a: number[][]): number[][] {
    const n = a.length;
    const cols = a.map((_, j) =>
        solve(
            a,
            a.map((_, i) => (i === j ? 1 : 0)),
        ),
    );
    return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => cols[j][i]));
}

/**
 * Logistic regression by Newton's method: `y` in [0, 1] (a draw is 0.5), `x`
 * rows with the intercept already in. Returns coefficients and standard errors.
 */
export function logistic(x: number[][], y: number[]): { beta: number[]; se: number[] } {
    const k = x[0].length;
    let beta = new Array(k).fill(0);
    let hessian: number[][] = [];
    for (let iter = 0; iter < 30; iter++) {
        const grad = new Array(k).fill(0);
        hessian = Array.from({ length: k }, () => new Array(k).fill(0));
        x.forEach((row, i) => {
            const p = 1 / (1 + Math.exp(-row.reduce((s, v, j) => s + v * beta[j], 0)));
            const w = p * (1 - p);
            for (let a = 0; a < k; a++) {
                grad[a] += (y[i] - p) * row[a];
                for (let b = 0; b < k; b++) hessian[a][b] += w * row[a] * row[b];
            }
        });
        const step = solve(hessian, grad);
        beta = beta.map((v, j) => v + step[j]);
        if (Math.max(...step.map(Math.abs)) < 1e-8) break;
    }
    const cov = invert(hessian);
    return { beta, se: cov.map((row, i) => Math.sqrt(row[i])) };
}

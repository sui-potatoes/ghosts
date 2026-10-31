// Exact mesh audit of every shipped clip, for both rigs and both long guns.
// Sidearm clips automatically use the pistol. Outputs machine-readable evidence.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const directory = process.env.REPORT_DIR ?? "/tmp/ghosts-pose-audit";
mkdirSync(directory, { recursive: true });
const runs = await Promise.all(
    ["female", "male"].flatMap((sex) =>
        ["rifle", "sniper"].map(
            (weapon) =>
                new Promise<{ sex: string; weapon: string; code: number; report: string }>(
                    (resolve) => {
                        const report = join(directory, `${sex}-${weapon}.json`);
                        const child = spawn(
                            process.execPath,
                            ["--experimental-strip-types", "tests/pose-audit.ts"],
                            {
                                env: {
                                    ...process.env,
                                    SEX: sex,
                                    WEAPON: weapon,
                                    FPS: process.env.FPS ?? "30",
                                    STRICT: "1",
                                    REPORT: report,
                                },
                                stdio: ["ignore", "pipe", "inherit"],
                            },
                        );
                        child.stdout.on("data", (data) => {
                            for (const line of data.toString().trim().split("\n")) {
                                try {
                                    const row = JSON.parse(line);
                                    console.log(
                                        `${sex}/${weapon} ${row.name}: ${row.worst.count} crossings`,
                                    );
                                } catch {
                                    console.log(line);
                                }
                            }
                        });
                        child.on("error", (error) => {
                            console.error(error);
                            resolve({ sex, weapon, code: 1, report });
                        });
                        child.on("exit", (code) =>
                            resolve({ sex, weapon, code: code ?? 1, report }),
                        );
                    },
                ),
        ),
    ),
);
let failed = false,
    frames = 0;
const summary = [];
for (const run of runs) {
    failed ||= run.code !== 0;
    const rows = JSON.parse(readFileSync(run.report, "utf8"));
    frames += rows.reduce((sum: number, row: { frames: number }) => sum + row.frames, 0);
    summary.push({
        sex: run.sex,
        weapon: run.weapon,
        clips: rows.length,
        frames: rows.reduce((s: number, r: { frames: number }) => s + r.frames, 0),
        failures: rows
            .filter((r: { worst: { count: number } }) => r.worst.count > 0)
            .map((r: { name: string; sets: unknown; worst: { time: number } }) => ({
                name: r.name,
                sets: r.sets,
                time: r.worst.time,
            })),
    });
    if (rows.length !== 38) failed = true;
}
writeFileSync(
    join(directory, "summary.json"),
    JSON.stringify(
        {
            fps: Number(process.env.FPS ?? 30),
            frames,
            sets: process.env.ONLY_SET ? [process.env.ONLY_SET] : ["body", "spectre", "nyx", "nyx-mid", "nyx-heavy", "field-kit"],
            runs: summary,
        },
        null,
        2,
    ),
);
console.log(`${failed ? "FAIL" : "PASS"}: ${frames} sampled poses. Reports: ${directory}`);
if (failed) process.exitCode = 1;

// Operative voice lines from ElevenLabs, written to `public/sounds` as
// `<phrase>-<sex>-<NN>.mp3` for `packages/engine/src/voice.ts`.
//
//   node scripts/generate-voices.mjs male-02 female-02
//
// Existing files are skipped, so each take is paid for once; pass --force to
// redo one. The key comes from ELEVENLABS_API_KEY or `.1lab` at the repo root.
// The 01 voices were made in the ElevenLabs app on 2026-10-19 with the same
// model and settings; their wording differs slightly from LINES below.
// `public/sounds/README.md` records what every file says; add new voices there.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SOUNDS = join(here, "../public/sounds");
const KEY_FILE = join(here, "../../.1lab");

/** Voice slots and the ElevenLabs voice behind each. */
const VOICES = {
    "male-01": { id: "IRHApOXLvnW57QJPQH2P", name: "Adam - American, Dark and Tough" },
    "female-01": { id: "wa4sQVgbDDzUDEzJwch3", name: "Eryn - Strong Female Military Commander" },
    "male-02": { id: "SOYHLrjzK2X1ezoPC6cr", name: "Harry - Fierce Warrior" },
    "female-02": { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah - Mature, Reassuring, Confident" },
};

/** Phrase file stem to spoken text; v4 reads the bracketed delivery tags. */
const LINES = {
    commander: "Commander?! Yes, Commander!",
    copy: "Copy!",
    onit: "On it!",
    "taking-cover": "Taking cover.",
    "taking-the-shot": "Taking the shot!",
    "target-neutralised": "Target neutralised.",
    "frag-out": "Frag out!",
    "fire-in-the-hole": "Fire in the hole!",
    "understood-holding-corner": "Understood. Holding this corner!",
    "staying-on-target-firing": "Staying on target. Firing!",
    "panting-im-hit": "[panting] I'm hit!",
};

const MODEL = "eleven_v4";
const SETTINGS = { stability: 0.5, similarity_boost: 0.75 };
const FORMAT = "mp3_44100_128";

function apiKey() {
    if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY.trim();
    const line = readFileSync(KEY_FILE, "utf8")
        .split("\n")
        .find((l) => l.startsWith("ELEVENLABS_API_KEY="));
    if (!line) throw new Error(`No ELEVENLABS_API_KEY in the environment or ${KEY_FILE}`);
    return line
        .slice("ELEVENLABS_API_KEY=".length)
        .trim()
        .replace(/^["']|["']$/g, "");
}

/** One take. Network stalls are retried; an API refusal stops the run before more credits go. */
async function speak(key, voiceId, text) {
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=${FORMAT}`;
    for (let attempt = 1; ; attempt++) {
        let response;
        try {
            response = await fetch(url, {
                method: "POST",
                headers: {
                    "xi-api-key": key,
                    "content-type": "application/json",
                    accept: "audio/mpeg",
                },
                body: JSON.stringify({ text, model_id: MODEL, voice_settings: SETTINGS }),
                signal: AbortSignal.timeout(120_000),
            });
        } catch (error) {
            if (attempt >= 8) throw error;
            console.warn(`  network: ${error.cause?.code ?? error.name}, retrying (${attempt})`);
            continue;
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        return Buffer.from(await response.arrayBuffer());
    }
}

const args = process.argv.slice(2);
const force = args.includes("--force");
const slots = args.filter((a) => !a.startsWith("--"));
if (!slots.length || slots.some((s) => !VOICES[s])) {
    console.error(
        `usage: node scripts/generate-voices.mjs <${Object.keys(VOICES).join("|")}>... [--force]`,
    );
    process.exit(1);
}

const key = apiKey();
for (const slot of slots) {
    const voice = VOICES[slot];
    console.log(`${slot}: ${voice.name}`);
    for (const [phrase, text] of Object.entries(LINES)) {
        const file = join(SOUNDS, `${phrase}-${slot}.mp3`);
        if (existsSync(file) && !force) {
            console.log(`  skip ${phrase} (exists)`);
            continue;
        }
        const audio = await speak(key, voice.id, text);
        writeFileSync(file, audio);
        console.log(
            `  ${phrase}: ${(audio.length / 1024).toFixed(1)} KiB  ${JSON.stringify(text)}`,
        );
    }
}

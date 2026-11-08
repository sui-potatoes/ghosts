# Sounds

Operative voice lines are `<phrase>-<sex>-<NN>.mp3`, played by
`packages/engine/src/voice.ts` (`PHRASES` maps game events to phrases,
`RECORDED` lists the voices on disk). A recruit's on-chain voice id maps to a
file voice as: even ids male, odd ids female, `NN = (id >> 1) + 1`.

This file is not cached by the service worker (`.md` is excluded from
`asset-manifest.json`).

## Voices

All from ElevenLabs, model `eleven_v4`, stability 0.5, similarity 0.75,
`mp3_44100_128`.

| Slot      | Chain id | UI label    | ElevenLabs voice                                       | Voice ID               | Made                                      |
| --------- | -------- | ----------- | ------------------------------------------------------ | ---------------------- | ----------------------------------------- |
| male-01   | 0        | Male · 01   | Adam - American, Dark and Tough (professional)         | `IRHApOXLvnW57QJPQH2P` | 2026-10-19, ElevenLabs app                |
| female-01 | 1        | Female · 01 | Eryn – Strong Female Military Commander (professional) | `wa4sQVgbDDzUDEzJwch3` | 2026-10-19, ElevenLabs app                |
| male-02   | 2        | Male · 02   | Harry - Fierce Warrior (premade)                       | `SOYHLrjzK2X1ezoPC6cr` | 2026-11-08, `scripts/generate-voices.mjs` |
| female-02 | 3        | Female · 02 | Sarah - Mature, Reassuring, Confident (premade)        | `EXAVITQu4vr4xnSDxMaL` | 2026-11-08, `scripts/generate-voices.mjs` |

The ElevenLabs app renders every line with both `eleven_v4` and
`eleven_v4_exp`; which of the two was kept for the 01 files is not recorded.

## Lines

What each file says. Square brackets are v4 delivery tags, not spoken. The 01
texts are recovered from the account's generation history (`GET /v1/history`,
under `dialogue`), matched to the files by time; where several takes exist, the
last one before the file was saved is listed.

| Phrase                      | Event        | male-01                          | female-01                   | male-02, female-02               |
| --------------------------- | ------------ | -------------------------------- | --------------------------- | -------------------------------- |
| `commander`                 | select       | Commander?! Yes, Commander!      | Commander?! Yes, Commander! | Commander?! Yes, Commander!      |
| `copy`                      | select, move | Copy                             | Copy!                       | Copy!                            |
| `onit`                      | move         | On it! Keep the lane clear.      | On it!                      | On it!                           |
| `taking-cover`              | cover        | Taking cover.                    | Taking cover.               | Taking cover.                    |
| `taking-the-shot`           | fire         | Taking the shot!                 | Taking the shot!            | Taking the shot!                 |
| `target-neutralised`        | kill         | Target neutralized!              | Target neutralised.         | Target neutralised.              |
| `frag-out`                  | grenade      | [excited] Frag out!              | frag out!                   | Frag out!                        |
| `fire-in-the-hole`          | grenade      | [menacing] Fire in the hole!     | fire in the hole!           | Fire in the hole!                |
| `understood-holding-corner` | hunker       | Understood. Holding this corner! | Understood! Holding corner. | Understood. Holding this corner! |
| `staying-on-target-firing`  | overwatch    | Staying on target, firing!       | Staying on target. Firing!  | Staying on target. Firing!       |
| `panting-im-hit`            | hit          | [panting] I'm hit!               | [panting] I'm hit!          | [panting] I'm hit!               |

## Adding or redoing a voice

1. Add the slot and its voice ID to `VOICES` in `app/scripts/generate-voices.mjs`
   (new line texts go in its `LINES`), then run
   `node scripts/generate-voices.mjs <slot>` from `app/`. The API key is read
   from `ELEVENLABS_API_KEY` or `.1lab` at the repo root. Existing files are
   skipped; delete one (or pass `--force`) to redo it.
2. Add the voice to `RECORDED` in `packages/engine/src/voice.ts` and to
   `VOICES` in `app/src/chain/ghosts.ts`. `NUM_VOICES` in
   `move/packages/ghosts/sources/account.move` caps the chain ids (4 today).
3. Add its rows to the tables above.

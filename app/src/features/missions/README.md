# features/missions — the mission console

An operations room for picking a mission: a queue of operations on the left,
the situation board in the middle (the locked mission's ground as a tile plot
under a status strip), the briefing with the commit control on the right.
Training (`/play/training`, `features/play/demo`) is its first user; a
faction mission board is meant to reuse every piece unchanged. Built on the
interface language in `src/ui/` (one cursor, commands in the bar); styles in
`missions.css`, scoped by the `gui-ops-` prefix.

## Pieces

| Piece              | What it is                                                                                                                                                                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OpsConsole`       | The layout: three columns, the board taking what the side panels leave; one scrolling column on a phone (it is the cursor's scroll container there).                                                                                                       |
| `OpsQueue`         | The operations as status lines (index, name, place, state over file code). Each line is a cursor target whose primary is the mission's `verb`: keys and pad commit at once, a click locks the board on the line and the next click commits. Lines preview. |
| `OpsBoard`         | The situation display. Draws `mission.plot` (walls, obstacles, voids, cover by edge and height, both deployments, the objective) on a ruled grid in whole pixels, or `mission.stages` in the same frame when there is no ground. One lock-on per retarget. |
| `StatusStrip`      | A row of readouts (`{ label, value, tone?, minor? }`) and, with `clock`, the UTC time. `minor` readouts drop first on a narrow console.                                                                                                                    |
| `BriefingPanel`    | Issuer, name, place and coordinates, the contract (`*word*` is an order name), objectives, intel facts, threat pips, reward when there is one, and the commit control under it all.                                                                        |
| `useLockedMission` | Which mission the console is locked on (the queue's subject: what the commit runs) and which one is shown (the line the pointer rests on, else the locked one). Puts the cursor on the asked or next mission on arrival.                                   |
| `model.ts`         | The view-model and its pure helpers (`plotOf`, `withNext`, `openingMission`, `tally`, rules and clock), tested in `tests/missions-model.test.ts`.                                                                                                          |

The board and the briefing follow the pointer; the commit never does. It names
the mission it will run, so a pointer crossing the queue on its way to the
commit cannot change what is launched.

## The view-model

```ts
interface Mission {
    id: string;
    code?: string; // file code, "BL–09.007"
    name: string;
    location: string; // short: "Tokyo / Sector 09"
    place?: string; // the briefing's place line
    coordinates?: [lat, lon];
    issuer?: string;
    brief: string[]; // contract paragraphs
    objectives: { title; detail? }[];
    facts: { label; value }[]; // "Squad 4 operators", "Ground 18 × 14 tiles"
    threat?: { label; level; max };
    plot?: MissionPlot; // plotOf(moveMapTiles, { squad, hostiles }, objective)
    stages?: { id; title; done }[]; // drawn when there is no plot
    state: "open" | "done" | "locked";
    locked?: string; // the reason the bar gives; the commit is refused
    next?: true; // set by withNext
    verb: string; // the commit's label: "Deploy"
    // Faction wars (unused by training):
    faction?: { id; name };
    district?: { code; name };
    reward?: { label; value };
    standing?: { label; value; max };
}
```

Fields a source has no data for are left out, and the pieces draw nothing for
them: no placeholders, no invented values.

## A faction mission board

A faction board is another adapter like `features/play/demo/missions.ts`: read
the posted missions, map each onto `Mission` (its corporation as `faction`, the
city district as `district`, the offered `reward`, the player's `standing`
with that corporation, `locked` with a reason where the standing is too low),
call `withNext` if there is an order to suggest, and render

```tsx
<OpsConsole>
    <OpsQueue missions={missions} selected={locked?.id ?? null} onDeploy={take} />
    <OpsBoard mission={shown} strip={<StatusStrip readouts={…} clock />} />
    <BriefingPanel mission={shown} commit={locked} onDeploy={take} />
</OpsConsole>
```

inside the screen's `FocusRoot` and `ScreenFrame` (`columns="minmax(0, 1fr)"`).
The briefing shows the faction in its header and the reward with the intel. A
city map of districts would be a new board view beside `LayoutPlot`, keyed by
`district`, inside the same reticle.

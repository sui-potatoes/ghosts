# features/missions — the mission console

An operations room for picking a mission: a queue of operations on the left,
the situation board in the middle (the locked mission's ground as a tile plot
under a status strip), the briefing with the commit control on the right.
Training (`/play/training`, `features/play/demo`) is its first user; a
faction mission board is meant to reuse every piece unchanged. Built on the
interface language in `src/ui/` (one cursor, commands in the bar); styles in
`missions.css`, scoped by the `gui-ops-` prefix.

## Pieces

| Piece              | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OpsConsole`       | The layout: three columns, the board taking what the side panels leave; one scrolling column on a phone (it is the cursor's scroll container there).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `OpsQueue`         | The operations as status lines (index, name, place, state over file code). Each line is a cursor target whose primary is the mission's `verb`: keys and pad commit at once, a click locks the board on the line and the next click commits. Lines preview.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `OpsBoard`         | The situation display in two views that crossfade (200 ms), switched by the World / Site tabs in its header (the screen's `onTab` steps them): World is `WorldBoard`, Site is the ground as a site plan (`SitePlot` and `SiteLegend`, inside one lock-on) or `mission.stages` when there is no ground. A mission with no `position` shows its own board in either view. Takes `world` (every mission), `view`, `onView`, `zoom`, `onZoom`.                                                                                                                                                                                                                                                                                                                                                |
| `WorldBoard`       | The planet in the board, from `public/world/world-base.svg` (fetched and parsed once per visit, drawn by same-document `<use>` copies so it wraps east–west): graticule, the six continent names, an amber pin per city that holds a mission (`sitesOf`; a pin is a 32 px cursor target centred on the city, its name beside it), and on the shown mission's city a cyan lock-on with a readout (city, operation, coordinates) set on the side with least land. Every change of view is one eased rAF glide of one view (`usePan`; the shorter way round, longer for longer travel); pins and readout are placed from that view in the same frame. `ZoomControl` (in `WorldLegend`) and the wheel step `ZOOM_LEVELS`; the player's level holds across missions. No countries, no borders. |
| `StatusStrip`      | A row of readouts (`{ label, value, tone?, minor? }`). `minor` readouts drop first on a narrow console.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `BriefingPanel`    | Issuer, name, place and coordinates, the contract (`*word*` is an order name), objectives, intel facts, threat pips, reward when there is one, and the commit control under it all.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `useLockedMission` | The mission the console is on: the queue line under the cursor, however it got there (keys, pad, click, or the pointer coming to rest). Board, briefing and commit all follow it, so they never name different missions. Puts the cursor on the asked or next mission on arrival.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `model.ts`         | The view-model and its pure helpers (`plotOf`, `withNext`, `openingMission`, `tally`, rules), tested in `tests/missions-model.test.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `world.ts`         | The world's pure geometry over `model.ts`'s `project` (the base map's projection, equirectangular, 84° N to 60° S): `sitesOf`, `panView` (a place to the middle at a zoom, the shorter way round, never past the top or bottom edge), `nearestTurn`, `between`, `glideMs`, `ZOOM_LEVELS` / `stepZoom`, continent placements, graticule. Tested in `tests/missions-world.test.ts`.                                                                                                                                                                                                                                                                                                                                                                                                         |

The queue's cursor is the selection: the board, the briefing and the commit
always show the same mission, and the commit names it.

## The view-model

```ts
interface Mission {
    id: string;
    code?: string; // file code, "BL–09.007"
    name: string;
    location: string; // short: "Tokyo / Shinjuku"
    place?: string; // the briefing's place line
    coordinates?: [lat, lon];
    position?: { lat; lon; city }; // decimal degrees; drives the World pin. None: off the map
    preview?: { full; thumb; alt? }; // the location still at the briefing's head
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
    <OpsBoard
        mission={shown}
        world={missions}
        view={view}
        onView={setView}
        strip={<StatusStrip readouts={…} />}
    />
    <BriefingPanel mission={shown} commit={locked} onDeploy={take} />
</OpsConsole>
```

inside the screen's `FocusRoot` (with `onTab` stepping the board's view) and `ScreenFrame` (`columns="minmax(0, 1fr)"`). Each mission's `position` puts its city on the World view; missions in one city share one pin.
The briefing shows the faction in its header and the reward with the intel. A
city map of districts would be a new board view beside `LayoutPlot`, keyed by
`district`, inside the same reticle.

# src/ui — the game's interface language

Menus in Ghosts are a console game's menus, not web pages. This folder is the
one way to build them: a screen frame, one focus cursor, a command bar, panels
and rows, prompts, a 3D stage host. `/ui-sample` (`src/features/ui-sample/`)
is the living reference; everything it shows that is not sample data comes
from here.

```tsx
import { FocusRoot, ScreenFrame, FocusCommandBar, Panel, List, ListRow, useGlyphSet } from "../ui";
```

## The rules that make it a game

- **One cursor.** Exactly one thing is focused at any time; keys, pad, mouse
  and touch all move the same cursor. Nothing else highlights except the
  pointer's faint pre-highlight.
- **Commands live in the bar.** What you can do with the focused thing is in
  the command bar at the bottom edge, with the player's own key or pad glyph.
  No buttons over content, no per-row button clusters. (The mouse gets the
  same commands inline on the selected row and in a right-click/long-press
  list — generated from the same `commands`, never authored separately.)
- **No page scroll.** A screen is composed to fit the viewport. Long lists
  scroll inside their panel (`<List>`), following the cursor.
- **Text diet.** Keep a text element only if it answers a question the player
  has right now. Details appear when something is focused (the bar's hint,
  an expanded panel), not before.
- **Four type sizes:** `--t-micro` 10, `--t-label` 11, `--t-body` 13,
  `--t-title` 22. Emphasis is weight and colour, not size. One spacing unit
  `--u` (4px); control heights `--h-s/m/l`.
- **Visuals over words:** pictograms (`Icon`), bars, pips, thumbnails and the
  3D stage carry the meaning; labels are short.
- **Never show a mechanic the game doesn't have.** No invented currencies,
  weights, timers or items in a screen or a sample. Unfinished rules are
  either absent or clearly labelled sample data.
- Dark only, one cold accent spent sparingly, amber (`tone: "danger"`, warn)
  only for what needs attention.

## Wrapping a screen

```tsx
export default function Screen() {
    const glyphs = useGlyphSet();
    return (
        <FocusRoot
            back={{ action: "back", label: "Leave", run: leave }}
            onTab={step}
            onSection={jump}
        >
            <ScreenFrame
                location={["HQ", "Squad"]}
                onLocation={leave}
                tabs={<Tabs tabs={TABS} active={tab} onSelect={setTab} glyphs={glyphs} />}
                status={<StatusChip label="Match" value="Searching 01:24" state="live" />}
                columns="minmax(240px, 290px) minmax(0, 1fr) minmax(330px, 370px)"
                commands={<FocusCommandBar glyphs={glyphs} />}
                overlay={prompt}
            >
                <Panel>…</Panel>
            </ScreenFrame>
        </FocusRoot>
    );
}
```

- `FocusRoot` owns the screen's input (every menu action from `src/input.ts`)
  and **claims Back** (`back.ts`): the shell's `EscapeBack` stands aside while
  it is mounted, so the root `back` command is the way out. Dialogs that use
  `useBack` and open above the screen still close first. `onTab` gets the
  bumpers / Q·E, `onSection` the triggers / PgUp·PgDn; both only while no
  scope is stacked.
- `ScreenFrame` must be inside `FocusRoot`. It draws the header (breadcrumb,
  optional `siblings` sections, `tabs`, `status` chips), the body grid, the
  bar, the cursor and the command list. Root class `.gui` (+ `.ui-zoom` for
  phone landscape via `--ui-scale`); no upscaling on large displays.
- All CSS is `gui.css`, unlayered and scoped by the `gui-` prefix, so it is
  immune to `reset.css` and never leaks onto other screens.

## Making things focusable

Use the parts; each takes `id` (unique on the screen), `group` (its panel —
the cursor prefers to stay in a group and resumes a group's last row when it
re-enters), `title`/`hint` (what the bar says) and `commands`:

```ts
type Command = {
    action: "confirm" | "reset" | "back" | "nav";
    label: string;
    short?: string; // inline chip label
    tone?: "primary" | "danger";
    deny?: string; // shown but refused; the bar says why
    glyph?: "lr" | "ud"; // for nav: what the directions do
    run?: () => void;
};
```

A node's `back` command overrides the scope's Back (e.g. "Roster" returns to
the list). For a custom element use `useFocusable({ id, group, … })` and
spread `props` on it; `directions` lets a target consume arrows (steppers),
`pointer: false` keeps the mouse from moving the cursor (the stage),
`clickConfirm: false` stops a click confirming (choosers), `instant: true`
runs the primary on the first click (see Mouse and touch).

| Part          | Props (besides the focus ones)                                                                                                      |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `Panel`       | `label?`, `meta?`, `foot?`, `variant?: "solid" \| "ghost"`                                                                          |
| `Eyebrow`     | `children`, `meta?` — a heading inside a panel                                                                                      |
| `List`        | `label` — a column of rows that scrolls inside itself                                                                               |
| `ListRow`     | `name`, `thumb?`, `kind?`, `tag?`, `tagTone?`, `selected?`, `locked?`                                                               |
| `Thumb`       | `src?`, `icon?` — a row's leading picture                                                                                           |
| `StatRow`     | `label`, `icon?`, `value`, `base?`, `max`, `text?`, `lowerIsBetter?`                                                                |
| `SlotRow`     | `slot`, `icon?`, `image?`, `item?`                                                                                                  |
| `Stepper`     | `label`, `options: [id, label][]`, `value`, `onChange`                                                                              |
| `SwatchRow`   | `label`, `swatches: { id, name, colors[] }[]`, `value`, `onChange`                                                                  |
| `Slider`      | `label`, `value`, `min?`, `max?`, `segments?`, `onChange` — left/right steps, drag sets                                             |
| `GridPicker`  | `id`, `title`, `options`, `value`, `onPreview`, `onPick`, `onClose`, `columns?` — a large set as tiles, its own scope, live preview |
| `TextField`   | `label`, `value`, `onChange`, `onSubmit` — inside a Prompt; Enter submits, Escape is Back                                           |
| `ActionRow`   | `label`, `tone?` — a row that is one action                                                                                         |
| `EmptyState`  | `headline`, `children`, `action` — still a cursor target                                                                            |
| `Meter`       | `label`, `value`, `max`, `segments?`, `readout?`, `pending?` (not focusable)                                                        |
| `ReadoutLine` | `label`, `children`, `empty?` (not focusable)                                                                                       |
| `StatusChip`  | `label`, `value`, `state?: "idle" \| "live" \| "busy"`, `tone?`                                                                     |
| `Tabs`        | `tabs`, `active`, `onSelect`, `glyphs`                                                                                              |
| `Icon`        | `name`, `size?` — one stroke-only pictogram set (`STAT_ICON`, `SLOT_ICON`)                                                          |
| `Glyph`       | `action`, `set`, `nav?` — the player's binding or the pad button                                                                    |

A 3D scene that lays its own targets out (podiums over a canvas) calls
`store.relayout()` when they move without resizing, so the cursor follows.

Stage caption classes (inside `StagePanel`'s `caption`): `gui-stage-eyebrow`,
`gui-stage-title`, `gui-stage-sub`, `gui-stage-tag`; quiet copy: `gui-note`,
`gui-void` + `gui-void-mark`.

## Prompts

```tsx
<Prompt
    id="prompt-dismiss"
    tone="danger"
    eyebrow="Contract termination"
    title="Dismiss VEX?"
    lines={[["Gear", "Returned to the rack"]]}
    confirm={{ label: "Dismiss", run }}
    cancel={{ label: "Keep", run: close }}
    alternate={{ label: "Discard", run }}
    glyphs={glyphs}
>
    Consequence, named plainly.
</Prompt>
```

Pass it as the frame's `overlay`. It is a modal focus scope: the cursor is
trapped on it, Confirm / Back (and Reset for `alternate`) answer it from
anywhere, the header's tabs and sections wait until it is answered. A
non-modal stacked scope (a picker standing in for a panel) is a
`<FocusScope id back>`; a header click closes it first.

## Unsaved state

Keep the draft in the screen; show a `StatusChip` (`tone="warn"`) while it
differs; put Save on confirm and Discard on reset of the edited rows; route
every way out (root back, section switch, selection change) through one
`guard(go)` that opens a Prompt with Save / Discard / Keep editing.

## Long lists

Wrap rows in `<List label>`. It scrolls internally to keep the cursor's row
in view with the next row peeking in (keys) or just nudges a clipped row in
(pointer), draws a hairline rail and edge fades instead of a scrollbar, and
lets the wheel and a swipe scroll natively. While the cursor's row is
scrolled out of view the cursor hides; the next move brings it back.

## Hosting a 3D stage

```tsx
<StagePanel id="stage" group="stage" label="Stage" caption={…} back={toList}>
    <MyCanvas />
</StagePanel>
```

Z toggles the wireframe view on any screen with a stage: a hidden developer
shortcut on the input bus's shortcut lane (`useWireframeShortcut`, mounted by
`StagePanel`), shown nowhere — no command, chip or hint. It is silent while a
text field has focus or a rebind prompt is capturing, and yields when the player
has bound Z to a menu or combat action. Matches mount no stage, so combat keys
are never touched.

Inside the canvas component call `const attach = useStageAttach()` and, once
the renderer is up, `attach({ turn(angle), zoom(step), dragRate? })`. The host
owns the angle: keys (when inspecting), the right stick, a mouse drag and a
touch drag all change it and the canvas is told the absolute angle (positive
turns the model's front to the viewer's right). Wheel and pinch become zoom
steps. Pointer events are taken in the capture phase, so the renderer's own
orbit controls never see them. Render on demand: draw only when something
changed; never run an idle loop.

## Mouse and touch

- Hover only pre-highlights (CSS, `(hover: hover)` devices).
- A click or a tap selects. The primary (confirm) is the click itself:
    - `instant` targets run it on that same click — for a cheap, undoable
      primary: select an operative, open a picker, walk into a section;
    - the others run it on a second click or tap on the selected target — for
      a primary that commits something (issue, hire, requisition) or that the
      stage previews first (a picker row). Danger primaries are never instant.
- Inline chips (`InlineCommands`) are for **secondary** commands only (Reset:
  Remove, Manage). A target whose only command is its primary shows no chip
  and does not change height when selected; the command bar still names the
  primary with its glyph for keys and pad.
- Right-click, or a touch held still for 450 ms, opens the command list at
  the pointer when the target has a secondary (a focus scope: keys work in
  it, Back or a press outside closes it).
- The command bar's commands are click targets too.
- A command may carry `click: true`: a click or tap runs that one instead of
  the primary, on the first press. The armory's slot and Finish rows use it
  while a draft is open (Apply is the primary there; a tap must open the
  picker, never send a transaction).
- Choosers act on the first press: a Stepper's arrows and a SwatchRow's chips
  change the value AND move the cursor to their row, selected or not; a Slider's
  bar sets the value on press and drag. On touch (`hover: none` / coarse
  pointer) the arrows are always drawn, 44px on the glass each (`/--ui-scale`).
- Any key or pad action returns to the console presentation (no inline chips).

## Back is hierarchical

Back (Escape, pad B) never walks history. Closing the innermost thing comes
first (list, picker, prompt, inspect); then on a screen one press goes to its
parent, the menu (`src/routes.ts`, `useGoUp`): it pops the history entry when
the previous one is that parent, otherwise replaces the current entry with it.
Squad and Armory are sibling sections, so Armory also leaves for the menu.
Tab, section and query changes, and deep links between sections, use
`navigate(…, { replace: true })`, so the stack holds only real entries.
Don't call `navigate(-1)` for Back.

## Don't

- Don't add buttons over content or a second highlight style.
- Don't page-scroll; don't show a scrollbar.
- Don't name keys in copy; glyphs come from the player's bindings.
- Don't add `onAction` / key listeners in a screen built on `FocusRoot`;
  use commands, `directions`, `onTab`, `onSection`.
- Don't style outside the `gui-` prefix or rely on Tailwind classes inside
  `.gui` (they lose to `reset.css`'s unlayered rules).
- Don't show a mechanic, item or price the game doesn't have.

## Tests

`pnpm test:gui`: spatial navigation, scope stack and focus restore
(`tests/gui-focus.test.ts`), list windowing math (`tests/gui-list.test.ts`),
Back ownership (`tests/gui-back.test.ts`), route parents (`tests/routes.test.ts`).

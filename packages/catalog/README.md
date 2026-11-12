# Catalog

The reference list of what exists in the game, one JSON file per kind of thing. It is kept by
hand, for consistency between the contracts, the engine, the agent SDK and the UIs, and as the
place the UI text for each entry lives.

| File | What |
| --- | --- |
| `actions.json` | In-match actions |

Items (weapons, armor, weapon upgrades, utilities) and recruit skills get their own files in the
same shape when they are added.

## `actions.json`

One entry per action.

| Field | Meaning |
| --- | --- |
| `id` | The name everywhere: the `ActionKind` variant in `move/packages/ghosts/sources/map/action.move` for actions on chain |
| `tag` | The BCS tag of that variant. `null` when not on chain. Tags are never reused or reordered |
| `status` | `chain`: on chain and in every client. `engine`: in the demo engine only. `idea`: not built |
| `name` | Label for buttons and lists |
| `description` | One or two sentences for tooltips and help |
| `source` | What gives a unit the action: `base`, `weapon`, `utility`, `armor`, `skill`, `mission` |
| `ap` | Action points it costs: a number, or `"all"` when it spends whatever is left. `null` when undecided |
| `endsActivation` | Whether the unit can act again this turn afterwards |
| `uses` | Uses per match when its usual source limits it, else `null` for unlimited. On chain the count is on the `Action` an item grants, so an item can differ |
| `chain` | Entry function in `ghosts::ghosts`, or `null` |
| `engine` | The engine's order id, or `null` |
| `records` | History records the action can write on chain |

The numbers behind an action (range, damage, chances) are constants of its function on chain and
are not repeated here beyond what the description says. `docs/design/actions.md` has the design
notes and the per-unit tables.

# Catalog

The reference list of what exists in the game, one JSON file per kind of thing. It is kept by
hand, for consistency between the contracts, the engine, the agent SDK and the UIs, and as the
place the UI text for each entry lives.

| File | What |
| --- | --- |
| `actions.json` | In-match actions |
| `items.json` | Weapons, armor, weapon upgrades and utilities |

Recruit skills get their own file in the same shape when they are added.

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

## `items.json`

One entry per item a recruit can carry. Any recruit can carry any item: nothing is gated by rank.

| Field | Meaning |
| --- | --- |
| `id` | Stable name of the item in this catalog |
| `type` | `weapon`, `armor`, `upgrade` (fits a weapon) or `utility` |
| `status` | `chain`: created by `move/packages/ghosts/sources/recruit/items.move`. `app`: shown in the app's squad screens only, with no on-chain item behind it. `planned`: designed, not in the contract; listed only in the Armory's requisition catalog, where it cannot be requisitioned, and read by nothing that builds transactions, decodes objects, prices or plays a match. It has no `kind` and no `chain` |
| `name` | The item's name: for `chain` items, exactly the name the contract gives the object |
| `description` | One or two sentences for the UI |
| `tier` | Tier 1 to 3 where the item has tiers |
| `kind`, `slot` | For upgrades, the kind id on chain and the slot it takes on a weapon (one of each per weapon). For utilities, the kind id |
| `stats` | What the item adds to the unit that carries it, by `Stats` field name. A negative number takes away. A weapon's entry holds the weapon's own stats |
| `actions` | Actions the item gives the unit, as `kind` and `uses` (`null` is unlimited). A weapon gives `Attack` and `Reload` by being equipped; a utility lists them on the object |
| `chain` | The account function that requisitions it, with its arguments, and the one that equips it on a recruit. Upgrades are fitted to a weapon with `weapon::add_upgrade` rather than equipped on a recruit |
| `clientIds` | Ids of the looks and models that stand for the item in `packages/squad/src/catalog.ts` |

Stat fields and how modifiers combine are described in `docs/design/mechanics.md`, section 8.

# In-match actions per unit

Date: 2026-11-12.

A list of what a unit can do in a match today (chain, local engine, agent SDK) and, per unit kind,
which actions it would have under the "Change of Actions design" note in `ideas.md`. Section 1 is
the inventory with file references, section 2 a sketch of the `Action` enum, section 3 the per-unit
tables, section 4 the gaps. Paths: `chain/` is `move/packages/ghosts/sources/`, `engine/` is
`packages/engine/src/`, `agent/` is `packages/agent/src/`.

## 1. Inventory

Variant is the name used in the enum sketch and in the tables below. AP: every unit has 2 AP on
chain (`chain/map/unit.move:187`), engine (`engine/game.ts:69`) and agent SDK (read from the chain
`Unit`, `agent/bcs.ts:261`).

| Variant | Where | AP cost, end of activation | Preconditions | Random | Effect | History record(s) | Depends on today |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `Move` | chain `ghosts.move:378` `move_unit`, `map.move:172`, `unit.move:58`; engine `game.ts:367`; agent `rules.ts:402` | 1 AP, does not end the activation | AP > 0; path longer than 1 tile, at most `mobility` steps, no unit/wall/unwalkable/high-cover edge on it (`map.move:563`); engine also clears hunker and overwatch (`game.ts:187`) | none | moves the unit; the engine path may vault a cover tile (`game.ts:343`) | `Move(path)` | stat `mobility` |
| `Attack` (engine `fire`) | chain `ghosts.move:424` `perform_attack`, `map.move:211`, `unit.move:93`; engine `game.ts:427`; agent `rules.ts:413` | chain: sets AP to 0 (`unit.move:102`). Engine: sets AP to 0, except the pistol, which costs 1 (`game.ts:194`). Both take 1 ammo | AP > 0; ammo > 0; line of sight (walls and high cover block, `map.move:596`); distance at most `range` + 3 (`unit.move:28`); single-target weapon needs a unit on the target tile, area weapon any non-wall tile; engine and agent: target on the other side | chain: hit roll (`aim`, +5 per tile under range, -10 per tile over, minus target defense = cover 25/50 + `defense`), crit roll, damage +/- `spread`, `plus_one`, target dodge. Engine: flat 10% crit, no dodge or spread, seeded LCG (`game.ts:141`) | damage minus target `armor` (min 1); crit adds half the damage; area weapon explodes with radius `area_size` | `Attack`, then `Miss`; or `Dodged` / `Damage` / `CriticalHit`, `[UnitKIA]`; or `Explosion` and its records | stats `aim`, `damage`, `spread`, `plus_one`, `crit_chance`, `can_be_dodged`, `area_size`, `env_damage`, `range`, `ammo` (all from weapon, `unit.move:179`) |
| `Reload` | chain `ghosts.move:390`, `map.move:163`, `unit.move:66`; engine `game.ts:458`; agent `rules.ts:411` | 1 AP, does not end the activation | AP > 0; ammo below the maximum | none | ammo back to full | `Reload(x, y)` | stat `ammo` |
| `Grenade` | chain `ghosts.move:403`, `map.move:382`, `unit.move:74`; engine `game.ts:463`; agent `rules.ts:435` | 1 AP and 1 use, does not end the activation | AP > 0; a use left (the frag grenade has one per match); target within 5 tiles (Manhattan); target not a wall; no wall on the line of throw (covers do not block) | chain: none that matters (cannot be dodged; `apply_damage` still draws a number). Engine: none | every unit within 2 tiles (Manhattan, own units included) takes 4 minus `armor`, min 1 (engine: 6 minus `armor`); chain also destroys covers in the area | `Grenade`, `Explosion`, then `Damage` and `[UnitKIA]` per unit | constants `GRENADE_RANGE/RADIUS/DAMAGE` in `map.move`; the use count is on the `Action` from the unit's `Utility` (3.3) |
| `Overwatch` | engine only: `game.ts:491`, reaction `game.ts:435`, hostile phase `ai.ts:31` | sets AP to 0 | AP > 0; ammo >= 1; HUD hides it in versus games (`actions.ts:244`) | as `Attack` | until the next own turn, one reaction shot at an enemy that moves within `range` + 3; spent even with no line | event `overwatch`, `shot` with `reaction`, `watch-spent` | a loaded weapon |
| `Hunker` | engine only: `game.ts:486` | sets AP to 0 | AP > 0; hidden in versus games | none | defense against shots: 20 in the open, 50 behind a barrier, 60 behind a high wall (`game.ts:403`), until the next own turn or a move or shot | event `hunker` | nothing |
| `Secure` (HUD: Extract) | engine only: `game.ts:475`, label `keys.ts:55` | 1 AP, does not end the activation | AP > 0; unit stands on the relay cell; not yet secured; hidden in versus games | none | marks the objective taken; victory then needs all hostiles down (`game.ts:135`) | event `secure` | position (scenario `relay`) |
| `SwitchWeapon` | engine only: command `events.ts:53`, `game.ts:481`. No HUD binding, no key, nothing issues it | 0 AP (no cost applied, `game.ts:235`) | AP > 0; a different weapon | none | swaps rifle / sniper / pistol and the stats that go with it; each keeps its own magazine | event `switch-weapon` | nothing |

Match-level orders (not a unit's actions, so not in the enum):

| Order | Where | Notes |
| --- | --- | --- |
| `next_turn` | chain `ghosts.move:449`; agent `rules.ts:571`; engine `Encounter.nextTurn` / `hostilePhase` (`ai.ts:50`) | ends the side's turn, resets AP, writes `NextTurn`; the other side may call it once the turn limit has passed |
| `deploy_squad` | chain `ghosts.move:346`; agent `deploy` | writes `RecruitPlaced` per recruit |
| `abandon_game` | chain `ghosts.move:287`; agent `abandon` | other side wins, caller suspended |
| `complete_game` | chain `ghosts.move:300`; agent `complete` | wraps up a finished game |

Every unit order on chain first passes `begin_unit_action` (`ghosts.move:620`): the sender controls
the `Account`, it is that side's turn and in time, the tile holds a unit, the unit's `owner` is that
`Account`. The unit-level function then checks the unit's `actions`, before AP.

Counts of distinct unit actions: chain 4 (`Move`, `Attack`, `Reload`, `Grenade`); engine 8 (those
four plus `Overwatch`, `Hunker`, `Secure`, `SwitchWeapon`; the HUD binds 7, `keys.ts:14`); agent SDK
4 (`Move`, `Attack`, `Reload`, `Grenade`: `agent/types.ts:121`, `agent/contract.ts:199`). Plus
match-level orders: chain 3 in a match (`next_turn`, `deploy_squad`, `abandon_game`) and
`complete_game` after it; agent SDK the same four.

Gear on chain: `Weapon` (stats, up to 3 upgrades), `WeaponUpgrade` (stats only), `Armor` (stats
only), `Utility` (a stats modifier and actions; one item, the frag grenade). Weapons (`chain/recruit/items.move:46`): Standard Rifle (4 dmg, range 4, 3 ammo, 10% crit),
Sharpshooter Rifle (5 dmg, range 5, 20% crit, corporal), Plasma Rifle (6 dmg, range 5, 30% crit,
lieutenant). None has `area_size` or `env_damage` above 0. Upgrades: scope (+aim), laser sight
(+crit), stock (+range), expanded clip (+ammo). Armor: light (+1 armor, +10 dodge), medium (+2
armor), heavy (-1 mobility, +1 health, +3 armor, -10 dodge). Of the gear only a `Utility` adds an
action (`Grenade`); a weapon grants `Attack` and `Reload` implicitly.

## 2. Enum sketch

The four "on chain today" variants exist: `chain/map/action.move` (`ghosts::action`, constructors
`new_move` ... `new_grenade`, `from_bcs`). The rest is a sketch, not built. Unit variants only: every
action's parameters (path, target tile) already travel in the entry function and the `Record`.

```move
/// What an action does. Variant order is the BCS tag.
public enum ActionKind has copy, drop, store {
    // === on chain today ===
    Move,
    Attack, // `perform_attack`; the engine calls it `fire`
    Reload,
    Grenade,
    // === not yet on chain: engine only ===
    // Overwatch, Hunker, Secure, SwitchWeapon (payload kept out, the order carries it)
    // === not yet on chain: design note ===
    // PickUp, OpenDoor
}

/// A kind and its budget: how many times it may still be performed in a match.
public struct Action has copy, drop, store {
    uses: Option<u8>, // `none` is unlimited, `some(n)` is `n` left
    kind: ActionKind,
}
```

The count is on the `Action`: `none` is unlimited (`Move`, `Attack`, `Reload`), `some(n)` is `n` left,
so an action that can be done once a game (the frag grenade's `Grenade`, a quick shot) is an `Action`
with `uses: some(n)`, not a kind of its own. `Unit` carries `actions: vector<Action>`, filled by
`from_recruit` in this order: `Move` (base), `Attack` and `Reload` with a weapon, then the actions of
each equipped utility in slot order, as they are on the item. Nothing is merged: two grants of a
kind are two entries, each with its own count. Each unit-level `perform_*` first asserts `has_action`
(some entry of that kind), abort `EActionNotAllowed` (5), and spends through one helper: the first
entry of the kind with uses left (`none` counts as left), else `ENoUsesLeft` (6). `Unit` is read from
the object by BCS (`agent/bcs.ts`): `uses` is an option tag then the value, then the kind tag, and
variant order is the wire tag, so new kinds are only appended, never reordered.

### Action properties

An action's properties are hard-coded in its own function, not stored as data: `Move`, `Reload` and
`Grenade` each call `unit.ap.decrease(1)` (`Grenade` also spends a use) (`unit.move:62`, `:69`, `:78`), `Attack` calls
`unit.ap.deplete()` (`unit.move:102`), and the hit, crit and damage rules sit in the same function.

Two rules: a utility's `stats` are modifiers added to the unit that carries it, like an armor's, and
an action's own numbers live in its function (and the item only says how often it can be used, with
`uses`). So a variation of an action is a new action: its own `ActionKind` variant, its own
function, its own constants. Examples, for context only, none of them built:

| Variant | Differs from | AP | What changes |
| --- | --- | --- | --- |
| `QuickShot` | `Attack` | 1, does not end the activation | lower chance to hit; if once a game, `uses: some(1)` |
| ammo-type utility | none: no new action | as `Attack` | the utility's `stats` modify the weapon's (damage, crit, ...) like any modifier, `Attack` is unchanged |
| stun grenade | `Grenade` | 1 AP and 1 use | a new `ActionKind` with its own function: applies an effect (a status on the hit units) rather than damage |

A unit that has `QuickShot` in its `actions` may or may not also have `Attack`; the two are checked
separately.

## 3. Per unit kind

Source column: base, weapon, utility item, armor, skill, mission. Status: on chain today / engine
only / in the design note / proposed here.

### 3.1 Recruit, as on chain today

A hire carries a Standard Rifle (`account.move`, `hire`), so a recruit is without a weapon only once
its rifle is taken off. A recruit without a weapon still gets the default weapon stats
(`stats.move:69`) but no `Attack` or `Reload`; without a utility it has no `Grenade` either. Armed and carrying a frag grenade it has all four.

| Action | Source | Requires | Status |
| --- | --- | --- | --- |
| `Move` | base | `mobility` stat, 1 AP | on chain today |
| `Attack` | weapon | ammo, range, line of sight | on chain today |
| `Reload` | weapon | ammo below max | on chain today |
| `Grenade` | utility item (frag grenade, `uses: some(1)`) | a use left, range 5 | on chain today |

Weapon sub-cases: the standard rifle, the sharpshooter rifle (the "sniper" case: range 5, +20%
crit) and the plasma rifle (6 damage, +30% crit) give the same four actions and differ only in
stats (`items.move:46`). The engine's "sniper" (`engine/game.ts:12`, range 12, aim 88) and "pistol"
are engine-local weapons with no chain counterpart. Armor changes stats only.

### 3.2 Recruit without a weapon ("runner")

| Action | Source | Requires | Status |
| --- | --- | --- | --- |
| `Move` | base | `mobility` | on chain today |
| `Attack` | weapon | not available without a weapon | on chain today (refused) |
| `Reload` | weapon | not available without a weapon | on chain today (refused) |
| `Grenade` | utility item | not available without a grenade | on chain today (refused: `EActionNotAllowed`) |
| `PickUp` | mission | intel in reach (data extraction) | in the design note |
| `Secure` | mission | on the extraction point | proposed here: a runner must be able to finish the mission it exists for |

The note's "reach extraction first" has no matching action on chain: the engine's `Secure` is the
closest existing one.

### 3.3 Recruit with a grenade in the utility slot

| Action | Source | Requires | Status |
| --- | --- | --- | --- |
| `Move` | base | `mobility` | on chain today |
| `Attack`, `Reload` | weapon | as 3.1, with a weapon | on chain today |
| `Grenade` | utility item | frag grenade equipped, a use left | on chain today |

`Utility` (`chain/recruit/utility.move`) is an object like `Weapon` and `Armor`: `id`, `name`,
`stats` and `actions`. Its stats are a modifier added to the unit (a grenade adds nothing: zero), its
actions are added to the unit's `actions` with their `uses` (the frag grenade: `Grenade` with
`uses: some(1)`, once per match). The grenade's range, radius and damage are constants of
`Map.perform_grenade`. A recruit has a limited number of utility slots, `MAX_UTILITIES` in
`recruit.move`: one now, two intended. The note calls utilities also in-match consumables and says
that needs design: nothing is consumed by a match yet, uses refill each game like ammo.

### 3.4 Engine demo roles and enemies

Roles: Assault, Recon, Heavy, Specialist; enemies are the same roles with `enemy: true`
(`engine/scenario.ts:117`). They do not differ in actions: every unit gets `Move`, `Attack`,
`Reload`, `Grenade`, `Overwatch`, `Hunker`, `Secure`, `SwitchWeapon` through the same
`Encounter.apply` (`game.ts:279`). Differences are stats only (`game.ts:57`): Recon carries the
sniper, the rest the rifle; Heavy has armor 2 and mobility 5 against 1 and 7; Specialist is
identical to Assault; enemies have 9 hp against 12. The hostile AI (`ai.ts:50`) uses only `Move`,
`Reload` and `Attack`: it never throws, watches, hunkers or secures. The player's reactions to
hostile moves use `Overwatch` (`ai.ts:31`).

### 3.5 Turret

Does not exist in code or docs beyond the note's sentence "turret cannot perform move".

| Action | Source | Requires | Status |
| --- | --- | --- | --- |
| `Move` | none | not available | in the design note |
| `Attack` | weapon | a mounted weapon | proposed here: a turret needs some way to fire |
| `Reload` | weapon | ammo below max | proposed here: ammo is finite, so a turret has to be refillable or runs dry |
| `Overwatch` | weapon | loaded weapon | engine only: "camping" an extraction site (note) fits a unit that cannot move |

### 3.6 Training dummy

| Action | Source | Requires | Status |
| --- | --- | --- | --- |
| none | - | empty `actions` | in the design note ("cannot do anything") |

It still has `hp` and a tile, so it can be shot at and ends up in `UnitKIA` records.

### 3.7 VIP / escorted unit

Named in `ideas.md` (Mission Types, "Escort VIP"): one team gets a VIP to bring to the extraction
area; the other wins by eliminating it. No action list is given.

| Action | Source | Requires | Status |
| --- | --- | --- | --- |
| `Move` | base | `mobility` | in the design note (implied: it must reach extraction) |
| `Secure` | mission | on the extraction point | proposed here: "extract VIP" needs an action or a position check; the engine's `Secure` is the nearest |
| `Hunker` | base | nothing | proposed here: an unarmed escort has no other defence; engine only |

### 3.8 Other controllable objects

The docs name none beyond the above. `ideas.md` mentions "robotics and AI" as a direction and
`corporations.md` lists AI and Robotics as the source of "utilities"; `lore.md` has no unit kinds.
Doors are named as something a unit opens (`OpenDoor`, Concealment) but are not controllable.

## 4. Gaps between chain, engine and agent SDK

- `Overwatch`, `Hunker`, `Secure` and `SwitchWeapon` exist in `engine/game.ts` only. The chain has no
  entry function or `Record` for them (`history.move:13`); `GameRecord` and `Action` in
  `agent/types.ts` do not list them. In versus games the HUD refuses the first three
  (`engine/actions.ts:244`), but `Encounter.apply` would still accept them.
- The engine's `SwitchWeapon` is a command and an event but is bound to no key or button, and
  nothing in the engine or the app issues it. No role carries the pistol.
- Chain-only: `Explosion` from an area weapon, cover destruction (`env_damage`, grenade), dodge,
  `spread`, `plus_one`, hit chance from `aim`; the engine's `Attack` has a flat 10% crit and no
  dodge, and its grenade does 6 minus armor where chain does 4 (`engine/game.ts:468`,
  `map.move:51`).
- `Attack` ends the activation on chain and in the engine (pistol aside); the agent SDK's
  `applyDeterministic` (`agent/rules.ts:453`) does not model it, since dice rolls go last in a batch.
- Engine `Attack` and the agent's `attack` refuse a target on the actor's own side (`engine/game.ts:421`,
  `agent/rules.ts:419`); the chain checks no side in `perform_attack`. Grenades hit every unit in
  the area on chain and in the engine.
- The agent SDK's `refusal` (`agent/rules.ts:371`), the app's chain driver and the chain check the
  unit's `actions`; the engine has no such set.
- Engine units have a weapon by role; chain units without a weapon have default weapon stats and no
  `Attack` or `Reload`; the engine has no unarmed unit.
- The engine's `Hunker` and `Overwatch` end the activation by setting AP to 0; chain `Attack` does
  the same via `deplete`, while `Move`, `Reload` and `Grenade` cost 1 on both.

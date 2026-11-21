// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The focus cursor's model: one store per screen, exactly one focused node at
 * all times. Nodes register with a group (a panel) and a scope (the screen, or
 * a prompt stacked on it); directions move the cursor spatially, staying
 * inside the current group when it has a node that way and otherwise crossing
 * to the nearest group in that direction, where it lands on the node that
 * group had last. Each node carries its own commands (confirm, reset, back),
 * which is what the command bar shows and what Confirm / Reset / Back run.
 *
 * Plain TypeScript, no React and no app imports (sounds are injected), so the
 * navigation rules are unit-tested in `tests/gui-focus.test.ts`.
 */

import { HoldMachine } from "./tactile-model.ts";

/**
 * The actions a focused thing can answer; directions and tabs belong to the
 * screen. `nav` is display-only: it names what the directions do while a
 * target holds them (a stage rotating, a stepper stepping).
 */
export type CommandAction = "nav" | "confirm" | "reset" | "back";

export type Command = {
    action: CommandAction;
    label: string;
    /**
     * Inactive: shown, never run, with this short reason. The one inactive
     * state of the interface: the target dims (`data-inactive`, `aria-disabled`),
     * a press knocks instead of acting, nothing arms, and the command bar says
     * why while the cursor is on it. The cursor may still land on it so the
     * reason can be read.
     */
    deny?: string;
    /** Primary weighs heaviest in the bar; danger is the destructive variant. */
    tone?: "primary" | "danger";
    /** A shorter label for the inline chips on a row, where space is tight. */
    short?: string;
    /** For `nav`: which directions it names. */
    glyph?: "lr" | "ud";
    /**
     * A dangerous confirm runs only after being held (`HOLD_MS`): a press
     * starts the hold, releasing early cancels it. Keys, pad, mouse and touch.
     */
    hold?: boolean;
    /**
     * A click or tap on the target runs THIS command instead of the primary.
     * For a row whose primary is a commit elsewhere (Apply sends a transaction)
     * while its own cheap action (open a picker) is a secondary: a click must
     * never commit by surprise. Runs on the first click, so the row is `instant`.
     */
    click?: boolean;
    run?: () => void;
};

export type Dir = "up" | "down" | "left" | "right";

/** What the store needs of an element: its box, its place in the document. */
export type FocusElement = Pick<
    HTMLElement,
    "getBoundingClientRect" | "isConnected" | "compareDocumentPosition"
>;

export type FocusNode = {
    id: string;
    group: string;
    scope: string;
    el: FocusElement | null;
    /** What the command bar names while this node has the cursor. */
    title?: string;
    hint?: string;
    commands: Command[];
    /** Takes a direction before the cursor does (steppers, the stage); true consumes it. */
    directions?: (dir: Dir) => boolean;
    /** False: the pointer never moves the cursor onto this node (the 3D stage). */
    pointer?: boolean;
    /**
     * The stage previews this node while the cursor is on it, hovered or not
     * (a picker row a click acts on: the preview shows what the click does).
     * Commands still act on the subject (`preview` vs `subject`).
     */
    previews?: boolean;
};

export type FocusScopeEntry = {
    id: string;
    back: Command;
    restore: string | null;
    /** A modal scope (a prompt) blocks the screen's tabs and sections, even for the mouse. */
    modal: boolean;
};

/** A press or a refusal on the focused node, for the pressed/deny motion. */
export type Pulse = { id: string; action: CommandAction; kind: "press" | "deny"; n: number };

/**
 * The interface feedback (sounds, haptics); the React side passes the app's,
 * tests pass nothing. Each gets the element it happened on, for its pan.
 */
export type FocusSounds = {
    tick?: (el: FocusElement | null) => void;
    confirm?: (el: FocusElement | null) => void;
    back?: (el: FocusElement | null) => void;
    deny?: (el: FocusElement | null) => void;
    /** A hold reached step `step` of HOLD_STEPS (`progress` 0 to 1). */
    hold?: (el: FocusElement | null, step: number, progress: number) => void;
    /** A hold was let go before it completed. */
    holdCancel?: (el: FocusElement | null) => void;
};

/** A hold in progress: which target, which command, keyed for the driver. */
export type Hold = { id: string; command: Command; n: number };

/** How long a press keeps the target pushed in before it springs back. */
const PULSE_MS = 100;
/** The least gap between two ticks the pointer's sweep makes; keys are never limited. */
export const POINTER_TICK_GAP_MS = 90;
/** The mouse events a touch leaves behind arrive within this long of its release. */
const TOUCH_SHADOW_MS = 700;
const FOLLOWING = 4; // Node.DOCUMENT_POSITION_FOLLOWING

function signature(node: Pick<FocusNode, "title" | "hint" | "commands">): string {
    return JSON.stringify([
        node.title,
        node.hint,
        node.commands.map((c) => [c.action, c.label, c.deny, c.tone, c.glyph]),
    ]);
}

export class FocusStore {
    private nodes = new Map<string, FocusNode>();
    private sigs = new Map<string, string>();
    private scopes: FocusScopeEntry[];
    private memory = new Map<string, string>();
    private pendingRestore: string | null = null;
    /**
     * The focused node that just unmounted under the cursor, until the player
     * moves: a scope opened in the same commit (a picker standing in for its
     * rows) returns there, not to the fallback the cursor was parked on.
     */
    private lost: string | null = null;
    /**
     * The group the cursor was in when its node unmounted, until the commit
     * settles (a microtask): a node of the same group registering meanwhile
     * (a tab's new rows replacing the old) takes the cursor. Only then does
     * the cursor fall back elsewhere, and a fallback never rewrites another
     * panel's remembered row.
     */
    private orphan: { group: string; scope: string } | null = null;
    private listeners = new Set<() => void>();
    private sounds: FocusSounds;
    focused: string | null = null;
    /**
     * The last input was the mouse or a touch: the focused row then shows its
     * commands inline. Any menu action from keys or pad clears it.
     */
    pointer = false;
    /**
     * The target a click or tap has selected but not yet confirmed: a target
     * that is not `instant` runs its primary on the next click while this is
     * it. It is the explicit selection a command acts on, so the pointer
     * sweeping over other targets (hover, a finger resting) never clears it:
     * the cursor goes there, the selection stays. A key or pad move, a click
     * elsewhere or a scope change clears it. The cursor draws it as armed.
     */
    armed: string | null = null;
    /**
     * The last node the cursor reached by an explicit act (keys, pad, a click
     * or tap, a scope's initial focus or restore); never one the pointer only
     * passed over. It is what commands act on (`subject`).
     */
    private chosen: string | null = null;
    /** Where the pointer last was (client px); movement is told from this. */
    private at: { x: number; y: number } | null = null;
    private lastTouch = -Infinity;
    private lastTick = -Infinity;
    /** The command list (right-click, long-press): which node, and where (client px). */
    menu: { id: string; x: number; y: number } | null = null;
    pulse: Pulse | null = null;
    /**
     * The cursor's last one-shot motion: a press, a refusal, or a bump when a
     * direction had nowhere to go. Never cleared; `n` keys the replay.
     */
    motion: { kind: "press" | "deny" | "bump"; dir?: Dir; n: number } | null = null;
    /** Refusals so far; keys the command bar's reason flash. */
    denies = 0;
    /** The dangerous answer being held, until it completes or is let go. */
    hold: Hold | null = null;
    private holding = new HoldMachine();
    /**
     * A hold that completed while its press is still down: the same press (a
     * key's auto-repeat) starts nothing until it is let go.
     */
    private spent: string | null = null;
    version = 0;
    private n = 0;

    constructor(rootBack: Command, sounds: FocusSounds = {}) {
        this.scopes = [{ id: "root", back: rootBack, restore: null, modal: false }];
        this.sounds = sounds;
    }

    subscribe = (fn: () => void) => {
        this.listeners.add(fn);
        return () => void this.listeners.delete(fn);
    };

    getVersion = () => this.version;

    private emit() {
        this.version++;
        for (const fn of this.listeners) fn();
    }

    get scope(): FocusScopeEntry {
        return this.scopes[this.scopes.length - 1];
    }

    /** A modal scope (a prompt) is open: tabs, sections and the header's clicks wait. */
    get blocked(): boolean {
        return this.scopes.some((s) => s.modal);
    }

    /**
     * Header navigation (a tab or section key, a header click) from wherever
     * the cursor is: refused while a modal scope (a prompt) is open; a
     * passing scope (a picker, the command list) is closed first, as its Back
     * would, so the switch lands on the screen itself. True when it may go on.
     */
    clearForHeader(): boolean {
        if (this.blocked) return false;
        for (let i = 0; i < 4 && this.scope.id !== "root"; i++) {
            const id = this.scope.id;
            this.scope.back.run?.();
            // The scope pops when its owner unmounts; a React close lands after this call.
            if (this.scope.id === id) break;
        }
        return true;
    }

    setRootBack(back: Command) {
        this.scopes[0].back = back;
    }

    node(id: string | null): FocusNode | undefined {
        return id ? this.nodes.get(id) : undefined;
    }

    /** The node a group's cursor was last on; a panel's "current" row. */
    remembered(group: string): string | undefined {
        return this.memory.get(group);
    }

    /** Live nodes of a scope, in document order. */
    inScope(scope = this.scope.id): FocusNode[] {
        const list = [...this.nodes.values()].filter((n) => n.scope === scope && n.el?.isConnected);
        return list.sort((a, b) =>
            a.el!.compareDocumentPosition(b.el as unknown as Node) & FOLLOWING ? -1 : 1,
        );
    }

    register(node: FocusNode) {
        this.nodes.set(node.id, node);
        this.sigs.set(node.id, signature(node));
        const current = this.node(this.focused);
        if (node.id === this.pendingRestore && node.scope === this.scope.id) {
            // The node a closed scope came from, back after a remount (a picker
            // that stood in for its rows): the cursor returns to it.
            this.pendingRestore = null;
            this.orphan = null;
            this.setFocus(node.id, false);
        } else if (this.orphan) {
            // Its replacement in the same panel takes the cursor.
            if (node.scope === this.orphan.scope && node.group === this.orphan.group) {
                this.orphan = null;
                this.setFocus(node.id, false);
            }
        } else if (node.scope === this.scope.id && (!current || current.scope !== this.scope.id)) {
            this.setFocus(node.id, false);
        }
        this.emit();
    }

    /** Refresh a node's data; only a visible change (labels, reasons) re-renders. */
    update(
        id: string,
        data: Pick<
            FocusNode,
            "title" | "hint" | "commands" | "el" | "directions" | "pointer" | "previews"
        >,
    ) {
        const node = this.nodes.get(id);
        if (!node) return;
        Object.assign(node, data);
        const sig = signature(node);
        if (sig !== this.sigs.get(id)) {
            this.sigs.set(id, sig);
            if (id === this.focused) this.emit();
        }
    }

    unregister(id: string) {
        const node = this.nodes.get(id);
        this.nodes.delete(id);
        this.sigs.delete(id);
        if (this.armed === id) this.armed = null;
        if (this.chosen === id) this.chosen = null;
        if (this.hold?.id === id) {
            this.hold = null;
            this.holding.release();
        }
        if (this.menu?.id === id) this.menu = null;
        if (this.focused === id && node) {
            // The cursor never vanishes: whatever replaces it in the same panel
            // within this commit takes it, else the panel's next row, else
            // anything in scope. Decided once the commit settles.
            this.focused = null;
            this.lost = id;
            this.orphan = { group: node.group, scope: node.scope };
            queueMicrotask(() => this.settle());
            return;
        }
        this.emit();
    }

    /** Resolve a cursor whose node unmounted and nothing in its panel replaced it. */
    settle() {
        const orphan = this.orphan;
        if (!orphan) return;
        this.orphan = null;
        if (!this.node(this.focused)) {
            const rest = this.inScope();
            const same = rest.find((n) => n.group === orphan.group);
            const next = same ?? rest[0];
            if (next) {
                this.focused = next.id;
                this.chosen = next.id;
                if (same) this.memory.set(same.group, same.id);
            }
        }
        this.emit();
    }

    pushScope(id: string, back: Command, modal = false, start?: string) {
        this.settle();
        this.armed = null;
        this.scopes.push({ id, back, restore: this.lost ?? this.focused, modal });
        this.lost = null;
        // The node it names if it is there, else the scope's first.
        const named = start ? this.nodes.get(start) : undefined;
        const first = named?.scope === id ? named : this.inScope(id)[0];
        if (first) this.setFocus(first.id, false);
        this.emit();
    }

    popScope(id: string) {
        const i = this.scopes.findIndex((s) => s.id === id);
        if (i <= 0) return;
        const [scope] = this.scopes.splice(i, 1);
        this.armed = null;
        if (this.menu && id === "menu") this.menu = null;
        if (this.orphan?.scope === id) this.orphan = null;
        const back = this.node(scope.restore);
        if (back && back.scope === this.scope.id) this.setFocus(back.id, false);
        else {
            this.pendingRestore = scope.restore;
            if (this.node(this.focused)?.scope !== this.scope.id) {
                const first = this.inScope()[0];
                this.focused = first?.id ?? null;
                this.chosen = this.focused;
            }
        }
        this.emit();
    }

    private setFocus(id: string, sound: boolean, limited = false, now = 0, hover = false) {
        if (this.focused === id) return;
        this.focused = id;
        const node = this.nodes.get(id);
        if (!hover) {
            this.armed = null;
            this.chosen = id;
            if (node) this.memory.set(node.group, id);
        }
        if (sound && node?.el && (!limited || now - this.lastTick >= POINTER_TICK_GAP_MS)) {
            this.lastTick = now;
            this.sounds.tick?.(node.el);
        }
    }

    /**
     * Put the cursor on `id`; `sound` for moves the player made. `hover` is the
     * pointer passing over: the cursor and the hint follow it, but the explicit
     * selection (the armed target, the panel's remembered row) stays.
     */
    focus(id: string, sound = true, limited = false, now = performance.now(), hover = false) {
        if (!this.nodes.has(id)) return;
        if (!hover) this.chosen = id;
        if (this.focused === id) return;
        this.lost = null;
        this.orphan = null;
        this.setFocus(id, sound, limited, now, hover);
        this.emit();
    }

    /**
     * What a command acts on: the last node reached by an explicit act while it
     * is live in the open scope, else the one under the cursor. Previews and
     * the command bar read this, so hovering another target never retargets them.
     */
    get subject(): string | null {
        const node = this.chosen ? this.nodes.get(this.chosen) : undefined;
        return node && node.scope === this.scope.id ? node.id : this.focused;
    }

    /**
     * What a stage or an "if chosen" block shows: the node under the cursor when
     * it `previews`, hovered or not, else the subject. Never what a bar command
     * runs on: that stays the subject.
     */
    get preview(): string | null {
        const at = this.focused ? this.nodes.get(this.focused) : undefined;
        return at?.previews && at.scope === this.scope.id ? at.id : this.subject;
    }

    /** A node the pointer may move the cursor to: in the open scope, and not opted out. */
    private reachable(id: string | null): FocusNode | undefined {
        const node = id ? this.nodes.get(id) : undefined;
        return node && node.scope === this.scope.id && node.pointer !== false ? node : undefined;
    }

    /**
     * The pointer is at (`x`, `y`) over node `id`, or over none. The cursor
     * follows only real movement: the first event just records where the pointer
     * is, and an event at the same place (the browser re-testing hover after a
     * scroll or a re-layout, a synthetic move) is not movement. Touch is left to
     * `touchDown`, and the mouse events that shadow a touch are ignored. Moving
     * the pointer off every node leaves the cursor where it is. Returns whether
     * the cursor moved.
     */
    pointerMove(x: number, y: number, id: string | null, now = performance.now()): boolean {
        const last = this.at;
        this.at = { x, y };
        if (!last || (last.x === x && last.y === y)) return false;
        if (now - this.lastTouch < TOUCH_SHADOW_MS) return false;
        const node = this.reachable(id);
        if (!node) return false;
        this.pointerInput();
        if (this.focused === node.id) return false;
        this.focus(node.id, true, true, now, true);
        return this.focused === node.id;
    }

    /**
     * A finger went down on node `id`: the cursor moves to it at once, so the
     * bar shows its hint while the finger rests; nothing runs until the lift
     * (the click). A finger that slides off before lifting never clicks, and
     * leaves the cursor where it went.
     */
    touchDown(id: string, now = performance.now()) {
        this.lastTouch = now;
        const node = this.reachable(id);
        if (!node) return;
        this.pointerInput();
        this.focus(node.id, true, false, now, true);
    }

    /** A touch ended: its shadow mouse events (a click's hover) are ignored for a moment. */
    touchEnd(now = performance.now()) {
        this.lastTouch = now;
    }

    /**
     * A click or tap on node `id`: the cursor goes there and the command
     * `clickCommand` names runs, now or on the next click. A target that is not
     * `instant` is only armed by its first click, so a pointer that has already
     * moved the cursor onto it never commits on a click it did not mean twice.
     */
    click(
        id: string,
        commands: Command[],
        { instant, clickConfirm }: { instant: boolean; clickConfirm: boolean },
    ) {
        this.pointerInput();
        const again = this.armed === id;
        // A click elsewhere ends the selection; the hover that brought the
        // cursor here recorded nothing, so the click does.
        if (!again) this.armed = null;
        this.focus(id);
        const node = this.nodes.get(id);
        if (node) {
            this.memory.set(node.group, id);
            this.chosen = id;
        }
        // An inactive primary is never armed or run; the click only knocks.
        const refused = inactiveReason(commands);
        if (refused !== undefined && clickConfirm && !commands.some((c) => c.click)) {
            this.armed = null;
            this.run(commands.find((c) => c.action === "confirm")!);
            return;
        }
        const command = clickCommand(commands, { again, instant, clickConfirm });
        if (command) {
            this.armed = null;
            this.run(command);
        } else if (clickConfirm && !again && commands.some((c) => c.action === "confirm")) {
            this.armed = id;
            this.emit();
        }
    }

    /**
     * The inline confirm button of an armed target: it runs that target's
     * primary now, as the second click would, and disarms. The pointer may rest
     * on another target, so it acts on the armed one.
     */
    confirmArmed() {
        const id = this.armed;
        this.armed = null;
        const command = id
            ? this.nodes.get(id)?.commands.find((c) => c.action === "confirm")
            : null;
        if (!id || !command) {
            this.emit();
            return;
        }
        this.run(command, id);
    }

    /** The first node of a group, or the one it had last when `remember`. */
    focusGroup(group: string, remember = false, sound = false) {
        const nodes = this.inScope().filter((n) => n.group === group);
        const last = remember ? nodes.find((n) => n.id === this.memory.get(group)) : undefined;
        const target = last ?? nodes[0];
        if (target) this.focus(target.id, sound);
    }

    move(dir: Dir) {
        this.settle();
        this.lost = null;
        const current = this.node(this.focused);
        if (current?.directions?.(dir)) return;
        const nodes = this.inScope();
        if (!current?.el) {
            if (nodes[0]) this.focus(nodes[0].id);
            return;
        }
        const target = pickTarget(current, nodes, dir, (group) => this.memory.get(group));
        if (target) {
            this.focus(target.id);
        } else {
            this.motion = { kind: "bump", dir, n: ++this.n };
            this.emit();
        }
    }

    /** The command `action` resolves to on the focused node; back falls to the scope. */
    command(action: CommandAction): Command | undefined {
        const own = this.node(this.focused)?.commands.find((c) => c.action === action);
        if (own) return own;
        return action === "back" ? this.scope.back : undefined;
    }

    /** Targets moved without resizing (a 3D scene laid out anew): the cursor re-measures. */
    relayout() {
        this.emit();
    }

    /** Pointer input: mark the mouse or touch as the device in use (inline commands appear). */
    pointerInput() {
        if (this.pointer) return;
        this.pointer = true;
        this.emit();
    }

    /** Keys or pad: back to the console presentation. */
    keyInput() {
        // The pointer left the cursor on a hovered target while another is
        // selected: keys act on the selection, so the cursor returns to it.
        const subject = this.subject;
        const snap = subject !== null && subject !== this.focused;
        if (snap) this.focused = subject;
        if (!this.pointer && !snap) return;
        this.pointer = false;
        this.emit();
    }

    openMenu(id: string, x: number, y: number) {
        this.menu = { id, x, y };
        this.emit();
    }

    closeMenu() {
        if (!this.menu) return;
        this.menu = null;
        this.emit();
    }

    /**
     * Run a command with its feedback: pressed or refused, and the sound. A
     * `hold` command only starts its hold here; `holdFrame` completes it.
     */
    run(command: Command, target?: string | null, now = performance.now()) {
        const id = target ?? this.focused ?? "";
        const el = this.node(id)?.el ?? null;
        if (command.deny) {
            this.sounds.deny?.(el);
            this.denies++;
            this.flash({ id, action: command.action, kind: "deny", n: ++this.n });
            return;
        }
        if (command.hold && command.action !== "back") {
            this.beginHold(command, id, now);
            return;
        }
        if (command.action === "back") this.sounds.back?.(el);
        else this.sounds.confirm?.(el);
        this.flash({ id, action: command.action, kind: "press", n: ++this.n });
        command.run?.();
    }

    /** A press on a hold command: the hold starts (a key's auto-repeat is ignored). */
    private beginHold(command: Command, id: string, now: number) {
        const key = `${id}:${command.action}`;
        if (this.spent === key || !this.holding.begin(key, now)) return;
        this.hold = { id, command, n: ++this.n };
        this.sounds.hold?.(this.node(id)?.el ?? null, 0, 0);
        this.emit();
    }

    /**
     * The hold's clock, read once a frame while one runs: a tick per step;
     * at the end the command runs as a press would. Returns the progress
     * (0 to 1), or null when nothing is held.
     */
    holdFrame(now = performance.now()): number | null {
        const hold = this.hold;
        if (!hold) return null;
        const frame = this.holding.frame(now);
        const el = this.node(hold.id)?.el ?? null;
        if (frame.done) {
            this.hold = null;
            this.spent = `${hold.id}:${hold.command.action}`;
            this.sounds.confirm?.(el);
            this.flash({ id: hold.id, action: hold.command.action, kind: "press", n: ++this.n });
            hold.command.run?.();
            return 1;
        }
        if (frame.stepped) this.sounds.hold?.(el, frame.step, frame.progress);
        return frame.progress;
    }

    /** The held press was let go: before completion the hold is cancelled. */
    releaseHold() {
        this.spent = null;
        const hold = this.hold;
        if (!hold) return;
        this.hold = null;
        if (this.holding.release() === "cancelled")
            this.sounds.holdCancel?.(this.node(hold.id)?.el ?? null);
        this.emit();
    }

    invoke(action: CommandAction): boolean {
        if (action === "nav") return false;
        // Any other answer while a hold runs lets it go first.
        if (action !== "confirm" && this.hold) {
            this.releaseHold();
            if (action === "back") return true;
        }
        // Back first disarms a target waiting for its second click.
        if (action === "back" && this.armed !== null) {
            this.armed = null;
            this.emit();
            return true;
        }
        this.settle();
        const command = this.command(action);
        if (!command) return false;
        this.run(command);
        return true;
    }

    private flash(pulse: Pulse) {
        this.pulse = pulse;
        this.motion = { kind: pulse.kind, n: pulse.n };
        this.emit();
        setTimeout(() => {
            if (this.pulse?.n !== pulse.n) return;
            this.pulse = null;
            this.emit();
        }, PULSE_MS);
    }
}

/**
 * Where `dir` takes the cursor from `current`: the nearest node that way in
 * its own group; else the nearest group that way, resuming on the node that
 * group had last (a panel never visited starts at its top); else, vertically,
 * the list wraps inside its own group. Undefined: nowhere to go (a bump).
 */
export function pickTarget(
    current: FocusNode,
    nodes: FocusNode[],
    dir: Dir,
    remembered: (group: string) => string | undefined,
): FocusNode | undefined {
    const from = current.el!.getBoundingClientRect();
    const same = nodes.filter((n) => n.group === current.group && n !== current);
    let target = nearest(from, same, dir);
    if (!target) {
        const other = nodes.filter((n) => n.group !== current.group);
        const hit = nearest(from, other, dir);
        if (hit) {
            const backId = remembered(hit.group);
            const back = backId ? other.find((n) => n.id === backId) : undefined;
            target = back ?? other.find((n) => n.group === hit.group) ?? hit;
        }
    }
    if (!target && (dir === "up" || dir === "down") && same.length) {
        const sorted = [current, ...same].sort(
            (a, b) => a.el!.getBoundingClientRect().top - b.el!.getBoundingClientRect().top,
        );
        target = dir === "down" ? sorted[0] : sorted[sorted.length - 1];
    }
    return target;
}

type Box = Pick<DOMRect, "top" | "bottom" | "left" | "right" | "width" | "height">;

/**
 * The best node in `dir` from `from`: candidates must lie that way; the
 * distance along the direction counts once, the offset across it twice, and
 * an overlap across the direction costs nothing (rows straight below win).
 */
export function nearest<N extends { el: FocusElement | null }>(
    from: Box,
    nodes: N[],
    dir: Dir,
): N | undefined {
    let best: N | undefined;
    let score = Infinity;
    const slack = 2;
    for (const node of nodes) {
        const r = node.el!.getBoundingClientRect();
        if (!r.width && !r.height) continue;
        let along: number;
        let across: number;
        if (dir === "down" || dir === "up") {
            along = dir === "down" ? r.top - from.bottom : from.top - r.bottom;
            if (along < -slack) continue;
            across = Math.max(0, r.left - from.right, from.left - r.right);
        } else {
            along = dir === "right" ? r.left - from.right : from.left - r.right;
            if (along < -slack) continue;
            across = Math.max(0, r.top - from.bottom, from.top - r.bottom);
            // Sideways into a column, prefer the row level with the cursor.
            across += Math.abs(r.top + r.height / 2 - (from.top + from.height / 2)) * 0.25;
        }
        const s = Math.max(0, along) + across * 2;
        if (s < score) {
            score = s;
            best = node;
        }
    }
    return best;
}

/** Why a target's primary (its Confirm) is inactive right now; undefined when it can run. */
export function inactiveReason(commands: Command[]): string | undefined {
    return commands.find((c) => c.action === "confirm")?.deny || undefined;
}

/**
 * What the pointer reaches on the target itself (inline chips, the command
 * list): its secondary commands. The primary is the click, and the command
 * bar names it with its glyph for keys and pad.
 */
export function secondaryCommands(commands: Command[]): Command[] {
    return commands.filter((c) => c.action === "reset");
}

/**
 * The one command a row may carry as a button on itself: its own primary, and
 * only while it waits for its second click (`armed`) or the target is `offered`
 * as a two-step action, never when the primary is refused. Secondary commands
 * (Refresh, More, Sort, Default...) and list-wide ones never get an inline
 * button: they live in the command bar and the right-click list, so a row
 * grows nothing because the pointer is over it.
 */
export function inlineConfirm(
    commands: Command[],
    { armed, offered }: { armed: boolean; offered: boolean },
): Command | undefined {
    if (!(armed || offered) || inactiveReason(commands) !== undefined) return undefined;
    return commands.find((c) => c.action === "confirm");
}

/**
 * The command a click or tap on a target runs. `instant` targets (selecting,
 * opening a picker: cheap and undoable) run their primary on the first click;
 * the others run it on a click while already focused, unless `clickConfirm`
 * is off (choosers, whose clicks belong to their arrows and swatches).
 */
export function clickCommand(
    commands: Command[],
    { again, instant, clickConfirm }: { again: boolean; instant: boolean; clickConfirm: boolean },
): Command | undefined {
    if (!clickConfirm) return undefined;
    const own = commands.find((c) => c.click);
    if (own) return own;
    if (!(instant || again)) return undefined;
    return commands.find((c) => c.action === "confirm");
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFrameMessage, parseShellMessage } from "./shell-bridge.ts";

test("shell messages are accepted only in their exact shape", () => {
  assert.deepEqual(parseShellMessage({ type: "ghosts:pause", paused: true }), {
    type: "ghosts:pause",
    paused: true,
  });
  assert.deepEqual(parseShellMessage({ type: "ghosts:restart", extra: 1 }), {
    type: "ghosts:restart",
  });
  assert.equal(parseShellMessage({ type: "ghosts:pause" }), null);
  assert.equal(parseShellMessage({ type: "ghosts:pause", paused: "yes" }), null);
  assert.equal(parseShellMessage({ type: "evil" }), null);
  assert.equal(parseShellMessage("ghosts:restart"), null);
  assert.equal(parseShellMessage(null), null);
});

test("frame messages are accepted only in their exact shape", () => {
  assert.deepEqual(parseFrameMessage({ type: "ghosts:pause-request" }), {
    type: "ghosts:pause-request",
  });
  assert.equal(parseFrameMessage({ type: "ghosts:pause", paused: true }), null);
  assert.equal(parseFrameMessage(undefined), null);
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./useSubagentResult.ts", import.meta.url), "utf8");

// The helpers are not exported on purpose: this is a wiring contract, and the
// observable behaviour is covered by rendering the dock.
test("reads the child's last assistant turn through the context endpoint", () => {
  assert.match(source, /\/api\/sessions\/\$\{encodeURIComponent\(sessionId\)\}\/context\?\$\{params\}/);
  assert.match(source, /deferThinking: "1", deferMedia: "1", tail: "8"/);
  // Backwards, so the final reply wins rather than the first thing it said.
  assert.match(source, /for \(let index = messages\.length - 1; index >= 0; index -= 1\)/);
});

test("a failed fetch clears the result instead of throwing", () => {
  assert.match(source, /controller\.abort\(\)/);
  assert.match(source, /setText\(null\)/);
});

test("ignores a response for a session the user already navigated away from", () => {
  assert.match(source, /if \(!active\) return;/);
});

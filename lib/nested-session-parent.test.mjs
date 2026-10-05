import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { resolveParentsByDirectory, childSessionDirFor } = await jiti.import("./nested-session-parent.ts");

// The two layouts in the wild: pi-web's built-in runtime names the folder after
// the parent's session id, and nicobailon/pi-subagents names it after the
// parent's file stem. Both must resolve to the same parent.
const PROJECT = "/home/u/.pi/agent/sessions/-proj";
const PARENT_FILE = `${PROJECT}/2026-01-01T00-00-00-000Z_018f4e2a-1b2c-7d3e-9f40-abcdef012345.jsonl`;

test("a folder named after the parent file stem links back to that parent", () => {
  const child = `${PROJECT}/2026-01-01T00-00-00-000Z_018f4e2a-1b2c-7d3e-9f40-abcdef012345/2026-01-01T00-01-00-000Z_child1.jsonl`;
  const links = resolveParentsByDirectory([PARENT_FILE, child]);
  assert.equal(links.get(child), PARENT_FILE);
});

test("a folder named after the parent session id links back to that parent", () => {
  const child = `${PROJECT}/018f4e2a-1b2c-7d3e-9f40-abcdef012345/2026-01-01T00-01-00-000Z_child1.jsonl`;
  const links = resolveParentsByDirectory([PARENT_FILE, child]);
  assert.equal(links.get(child), PARENT_FILE);
});

test("a child nested per run resolves through the nearest named ancestor", () => {
  // The real nicobailon/pi-subagents layout, verified against a run on disk:
  // <parent folder>/<child run id>/run-0/session.jsonl. Only a direct-child
  // rule would leave every one of these children top-level.
  const child = `${PROJECT}/2026-01-01T00-00-00-000Z_018f4e2a-1b2c-7d3e-9f40-abcdef012345/run-42/run-0/session.jsonl`;
  const links = resolveParentsByDirectory([PARENT_FILE, child]);
  assert.equal(links.get(child), PARENT_FILE);
});

test("a grandchild joins its own parent, not the outermost one", () => {
  // Nearest match wins, so a child of a child does not attach to the root.
  const childId = "child-parent";
  const childPath = `${PROJECT}/2026-01-01T00-00-00-000Z_018f4e2a-1b2c-7d3e-9f40-abcdef012345/2026-01-01T00-01-00-000Z_${childId}.jsonl`;
  const grandchild = `${PROJECT}/2026-01-01T00-00-00-000Z_018f4e2a-1b2c-7d3e-9f40-abcdef012345/2026-01-01T00-01-00-000Z_${childId}/run-0/session.jsonl`;
  const links = resolveParentsByDirectory([PARENT_FILE, childPath, grandchild]);
  assert.equal(links.get(grandchild), childPath);
});

test("an ancestor walk is bounded", () => {
  const deep = `${PROJECT}/2026-01-01T00-00-00-000Z_018f4e2a-1b2c-7d3e-9f40-abcdef012345/${"a/".repeat(20)}session.jsonl`;
  assert.equal(resolveParentsByDirectory([PARENT_FILE, deep]).size, 0);
});

test("a top-level session is never treated as a child", () => {
  const other = `${PROJECT}/2026-01-02T00-00-00-000Z_def456.jsonl`;
  assert.equal(resolveParentsByDirectory([PARENT_FILE, other]).size, 0);
});

test("a folder whose name matches nothing in that directory links to nothing", () => {
  const child = `${PROJECT}/2026-01-01T00-00-00-000Z_018f4e2a-1b2c-7d3e-9f40-abcdef012345/2026-01-01T00-01-00-000Z_child1.jsonl`;
  const foreignParent = "/home/u/.pi/agent/sessions/-other/2026-01-01T00-00-00-000Z_018f4e2a-1b2c-7d3e-9f40-abcdef012345.jsonl";
  const links = resolveParentsByDirectory([foreignParent, child]);
  assert.equal(links.size, 0, "a same-named session in another project must not capture this child");
});

test("several children of one parent all link back", () => {
  const children = [1, 2, 3].map(
    (n) => `${PROJECT}/2026-01-01T00-00-00-000Z_018f4e2a-1b2c-7d3e-9f40-abcdef012345/2026-01-01T00-0${n}-00-000Z_child${n}.jsonl`,
  );
  const links = resolveParentsByDirectory([PARENT_FILE, ...children]);
  assert.equal(links.size, 3);
  for (const child of children) assert.equal(links.get(child), PARENT_FILE);
});

test("childSessionDirFor matches the folder the child is written into", () => {
  assert.equal(
    childSessionDirFor(PARENT_FILE),
    `${PROJECT}/2026-01-01T00-00-00-000Z_018f4e2a-1b2c-7d3e-9f40-abcdef012345`,
  );
});

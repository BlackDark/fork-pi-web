import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { summarizeSubagentStatus, summarizeSubagents } = await jiti.import("./subagent-family-status.ts");

test("a family with no children has no status to show", () => {
  assert.equal(summarizeSubagentStatus([]), null);
  assert.deepEqual(summarizeSubagents([]), { count: 0, status: null });
});

test("a live child outranks every settled state", () => {
  assert.equal(summarizeSubagentStatus(["completed", "failed", "running"]), "running");
  assert.equal(summarizeSubagentStatus(["failed", "queued"]), "queued");
  assert.equal(summarizeSubagentStatus(["completed", "starting"]), "starting");
});

test("a failure outranks a plain stop once nothing is live", () => {
  assert.equal(summarizeSubagentStatus(["completed", "aborted", "failed"]), "failed");
});

test("an interrupted child is reported rather than hidden", () => {
  assert.equal(summarizeSubagentStatus(["completed", "interrupted"]), "interrupted");
  assert.equal(summarizeSubagentStatus(["aborted", "interrupted"]), "interrupted");
});

test("unknown and missing statuses are ignored", () => {
  assert.equal(summarizeSubagentStatus([undefined, "completed", undefined]), "completed");
  assert.equal(summarizeSubagentStatus([undefined]), null);
});

test("a settled family reads as completed", () => {
  assert.equal(summarizeSubagentStatus(["completed", "completed"]), "completed");
});

test("only sub-agent relations contribute a status", () => {
  const base = { id: "x", path: "x.jsonl", cwd: "/tmp/a", created: "2026-01-01T00:00:00.000Z", modified: "2026-01-01T00:00:00.000Z", messageCount: 0, firstMessage: "x" };
  // listSessionFamilies only ever puts sub-agent relations in `subagents`, so
  // the count is the array length; a stray non-child must not set the status.
  assert.deepEqual(summarizeSubagents([
    { ...base, id: "plain" },
    { ...base, id: "child", relation: { kind: "subagent", parentSessionId: "p", profile: "scout", description: "d", status: "failed" } },
  ]), { count: 2, status: "failed" });
  assert.deepEqual(summarizeSubagents([{ ...base, id: "plain" }]), { count: 1, status: null });
});

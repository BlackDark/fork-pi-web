import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { subagentRunsFromToolResult } = await jiti.import("./subagent-tool-adapter.ts");

const BUILT_IN = {
  kind: "pi-web-subagent",
  sessionId: "child-1",
  profile: "scout",
  description: "map the code",
  status: "running",
  runInBackground: true,
  createdAt: "2026-01-01T00:00:00.000Z",
};

function externalResult(overrides = {}) {
  return {
    mode: "parallel",
    results: [{
      index: 0,
      agent: "reviewer",
      task: "check the diff",
      sessionId: "child-9",
      runId: "run-9",
      exitCode: 0,
      usage: {},
      ...overrides,
    }],
  };
}

test("pi-web's own tool result maps to a single run", () => {
  const runs = subagentRunsFromToolResult("Agent", BUILT_IN);
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0], {
    key: "child-1",
    sessionId: "child-1",
    agent: "scout",
    task: "map the code",
    status: "running",
    live: true,
    worktree: false,
    createdAt: "2026-01-01T00:00:00.000Z",
  });
});

test("an ordinary tool result is not treated as a sub-agent", () => {
  assert.equal(subagentRunsFromToolResult("read", { filePath: "/tmp/a" }), null);
  assert.equal(subagentRunsFromToolResult("bash", undefined), null);
  assert.equal(subagentRunsFromToolResult("subagent", { mode: "single" }), null);
  assert.equal(subagentRunsFromToolResult("subagent", { mode: "single", results: [] }), null);
});

test("a fan-out maps to one run per child, keyed by run id", () => {
  const runs = subagentRunsFromToolResult("subagent", externalResult());
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0], {
    key: "run-9",
    sessionId: "child-9",
    agent: "reviewer",
    task: "check the diff",
    status: "completed",
    live: false,
    runId: "run-9",
    mode: "parallel",
  });
});

test("several children in one result each become their own run", () => {
  const runs = subagentRunsFromToolResult("subagent", {
    mode: "parallel",
    results: [
      { agent: "a", task: "t1", sessionId: "s1", runId: "r1", exitCode: 0, usage: {} },
      { agent: "b", task: "t2", sessionId: "s2", runId: "r2", exitCode: 1, usage: {} },
      { agent: "c", task: "t3", sessionId: "s3", runId: "r3", exitCode: 0, usage: {} },
    ],
  });
  assert.deepEqual(runs.map((run) => [run.agent, run.status]), [["a", "completed"], ["b", "failed"], ["c", "completed"]]);
  assert.equal(new Set(runs.map((run) => run.key)).size, 3, "keys must be distinct for React");
});

test("a stopped child reads as aborted, not failed", () => {
  const runs = subagentRunsFromToolResult("subagent", externalResult({ exitCode: 130, stopped: true }));
  assert.equal(runs[0].status, "aborted");
});

test("an interrupted child keeps its own state", () => {
  const runs = subagentRunsFromToolResult("subagent", externalResult({ interrupted: true }));
  assert.equal(runs[0].status, "interrupted");
});

test("a timeout is a failure that says so", () => {
  const runs = subagentRunsFromToolResult("subagent", externalResult({ timedOut: true }));
  assert.equal(runs[0].status, "failed");
  assert.equal(runs[0].error, "Timed out");
});

test("a non-zero exit reports the code", () => {
  const runs = subagentRunsFromToolResult("subagent", externalResult({ exitCode: 2 }));
  assert.equal(runs[0].error, "Exited with code 2");
});

test("a killed child reports the signal", () => {
  const runs = subagentRunsFromToolResult("subagent", externalResult({ exitCode: 137, processSignal: "SIGKILL" }));
  assert.equal(runs[0].error, "Killed by SIGKILL");
});

test("a child with no session id still renders, keyed by position", () => {
  const runs = subagentRunsFromToolResult("subagent", {
    mode: "chain",
    results: [{ agent: "a", task: "t", exitCode: 0, usage: {} }],
  });
  assert.equal(runs[0].sessionId, undefined);
  assert.equal(runs[0].key, "chain-0");
});

test("malformed rows are skipped rather than throwing", () => {
  const runs = subagentRunsFromToolResult("subagent", {
    mode: "parallel",
    results: [null, "nope", { agent: "a", task: "t", sessionId: "s", exitCode: 0, usage: {} }],
  });
  assert.equal(runs.length, 1);
  assert.equal(runs[0].agent, "a");
});

test("an external result row is never treated as live", () => {
  // A results row only exists once the child settled, and a detached child's
  // row is never rewritten, so claiming "live" would spin forever.
  const runs = subagentRunsFromToolResult("subagent", externalResult());
  assert.equal(runs[0].live, false);
});

const { subagentNoticesFromDetails } = await jiti.import("./subagent-tool-adapter.ts");

test("completion notices become one row per child", () => {
  const notices = subagentNoticesFromDetails([
    { agent: "worker", status: "completed", source: "async", taskInfo: "fix the parser", resultPreview: "done", durationMs: 4200, workflowRunId: "r1" },
    { agent: "reviewer", status: "failed", source: "async", resultPreview: "boom", durationMs: 900 },
  ]);
  assert.equal(notices.length, 2);
  assert.deepEqual(notices[0], {
    key: "r1", agent: "worker", status: "completed",
    task: "fix the parser", resultPreview: "done", durationMs: 4200,
    runId: "r1", background: true,
  });
  assert.equal(notices[1].key, "notice-1");
});

test("notice states map the way run states do", () => {
  const notices = subagentNoticesFromDetails([
    { agent: "a", status: "completed" },
    { agent: "b", status: "stopped" },
    { agent: "c", status: "paused" },
    { agent: "d", status: "failed" },
    { agent: "e" },
  ]);
  assert.deepEqual(notices.map((notice) => notice.status), ["completed", "aborted", "interrupted", "failed", "failed"]);
});

test("a foreground notice is not marked background", () => {
  const [notice] = subagentNoticesFromDetails([{ agent: "a", status: "completed", source: "foreground" }]);
  assert.equal(notice.background, false);
});

test("a workflow child run id is used as the key when there is no workflowRunId", () => {
  const [notice] = subagentNoticesFromDetails([
    { agent: "a", status: "completed", childRuns: [{ runId: "child-1", agent: "a" }] },
  ]);
  assert.equal(notice.key, "child-1");
});

test("anything that is not a notice array is left alone", () => {
  assert.equal(subagentNoticesFromDetails(undefined), null);
  assert.equal(subagentNoticesFromDetails([]), null);
  assert.equal(subagentNoticesFromDetails({ agent: "a" }), null);
  assert.equal(subagentNoticesFromDetails([null, 3]), null);
});

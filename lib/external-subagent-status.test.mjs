import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { mapExternalState, readActiveExternalRuns, readExternalRun, readExternalRuns, resolveExternalAsyncRoot } =
  await jiti.import("./external-subagent-status.ts");

/** Points the extension's temp root at a fresh directory for one test. */
function useTempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-external-subagent-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const previous = process.env.PI_SUBAGENTS_TEMP_ROOT;
  process.env.PI_SUBAGENTS_TEMP_ROOT = root;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_SUBAGENTS_TEMP_ROOT;
    else process.env.PI_SUBAGENTS_TEMP_ROOT = previous;
  });
  return root;
}

function writeRun(root, runId, status) {
  const dir = path.join(root, "async-subagent-runs", runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "status.json"), JSON.stringify(status));
  return dir;
}

test("every extension state maps to pi-web's own status, and only two are live", () => {
  assert.deepEqual(mapExternalState("queued"), { status: "queued", live: true });
  assert.deepEqual(mapExternalState("running"), { status: "running", live: true });
  assert.deepEqual(mapExternalState("complete"), { status: "completed", live: false });
  assert.deepEqual(mapExternalState("failed"), { status: "failed", live: false });
  // The two spellings pi-web has no bucket of their own.
  assert.deepEqual(mapExternalState("partial"), { status: "failed", live: false });
  assert.deepEqual(mapExternalState("paused"), { status: "interrupted", live: false });
  assert.deepEqual(mapExternalState("stopped"), { status: "aborted", live: false });
  assert.deepEqual(mapExternalState("rejected"), { status: "aborted", live: false });
});

test("a missing, unknown or non-string state reads as starting and not live", () => {
  for (const state of [undefined, null, "", "unknown-state", 42, {}]) {
    assert.deepEqual(mapExternalState(state), { status: "starting", live: false }, `state ${String(state)}`);
  }
});

test("a run id that is not a plain name is refused before it reaches a path", async () => {
  for (const runId of ["../etc", "a/b", ".hidden", "-leading-dash", "", "x".repeat(129)]) {
    assert.equal(await readExternalRun(runId), null, runId);
  }
});

test("an unknown run id is null, not a throw", async (t) => {
  useTempRoot(t);
  assert.equal(await readExternalRun("0b8d2f14-0000-4000-8000-000000000000"), null);
});

test("reads a running run, its pid, its activity and every child session file", async (t) => {
  const root = useTempRoot(t);
  const runId = "0b8d2f14-1111-4111-8111-111111111111";
  const sessionDir = path.join(root, "sessions", `async-${runId}`);
  writeRun(root, runId, {
    lifecycleArtifactVersion: 3,
    runId,
    mode: "single",
    state: "running",
    sessionId: "/tmp/parent.jsonl",
    sessionDir,
    pid: process.pid,
    currentTool: "bash",
    currentPath: "src/lib/external-subagent-status.ts",
    activityState: "active_long_running",
    turnCount: 4,
    toolCount: 11,
    startedAt: 1_700_000_000_000,
    steps: [{ sessionFile: "/tmp/child.jsonl" }],
  });

  const run = await readExternalRun(runId);
  assert.ok(run);
  assert.equal(run.runId, runId);
  assert.equal(run.status, "running");
  assert.equal(run.rawState, "running");
  assert.equal(run.live, true);
  assert.equal(run.pidAlive, true);
  assert.deepEqual(run.activity, {
    tool: "bash",
    path: "src/lib/external-subagent-status.ts",
    state: "active_long_running",
    turnCount: 4,
    toolCount: 11,
  });
  assert.equal(run.startedAt, 1_700_000_000_000);
  assert.equal(run.endedAt, undefined);
  assert.equal(run.error, undefined);
  assert.deepEqual(run.sessionFiles, [
    path.join(root, "sessions", "run-0", "session.jsonl"),
    "/tmp/child.jsonl",
  ]);
});

test("partial keeps its own name while reading as failed", async (t) => {
  const root = useTempRoot(t);
  const runId = "0b8d2f14-2222-4222-8222-222222222222";
  writeRun(root, runId, { runId, mode: "parallel", state: "partial", error: "one child failed" });

  const run = await readExternalRun(runId);
  assert.equal(run.status, "failed");
  assert.equal(run.rawState, "partial");
  assert.equal(run.live, false);
  assert.equal(run.error, "one child failed");
  assert.equal(run.pidAlive, undefined);
});

test("malformed JSON and a missing run directory are null, not a throw", async (t) => {
  const root = useTempRoot(t);
  const runId = "0b8d2f14-3333-4333-8333-333333333333";
  const dir = path.join(root, "async-subagent-runs", runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "status.json"), "{ not json");

  assert.equal(await readExternalRun(runId), null);
  assert.equal(await readExternalRun("0b8d2f14-4444-4444-8444-444444444444"), null);
  // A JSON file that is not an object is malformed input too.
  const arrayRunId = "0b8d2f14-5555-4555-8555-555555555555";
  writeRun(root, arrayRunId, ["running"]);
  assert.equal(await readExternalRun(arrayRunId), null);
});

test("a dead pid is reported as not alive", async (t) => {
  const root = useTempRoot(t);
  const runId = "0b8d2f14-6666-4666-8666-666666666666";
  // pid 0 has no process of its own to signal, so kill(0, 0) is not our own pid.
  writeRun(root, runId, { runId, state: "running", pid: 0 });

  const run = await readExternalRun(runId);
  assert.equal(run.status, "running");
  assert.equal(run.pidAlive, undefined);
});

test("many runs read in parallel, skipping the ones that are gone", async (t) => {
  const root = useTempRoot(t);
  const first = "0b8d2f14-7777-4777-8777-777777777777";
  const second = "0b8d2f14-8888-4888-8888-888888888888";
  writeRun(root, first, { runId: first, state: "complete" });
  writeRun(root, second, { runId: second, state: "queued" });

  const runs = await readExternalRuns([first, second, "missing-run", "../etc", first]);
  assert.deepEqual([...runs.keys()], [first, second]);
  assert.equal(runs.get(first).status, "completed");
  assert.equal(runs.get(second).status, "queued");
  assert.equal(runs.get(first).live, false);
  assert.equal(runs.get(second).live, true);
});

test("only the marked live runs are listed, and a marker without a live run is dropped", async (t) => {
  const root = useTempRoot(t);
  const live = "0b8d2f14-9999-4999-8999-999999999999";
  const stopped = "0b8d2f14-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  writeRun(root, live, { runId: live, state: "running", pid: process.pid });
  writeRun(root, stopped, { runId: stopped, state: "complete" });

  const activeDir = path.join(root, "async-subagent-runs", ".active-runs");
  fs.mkdirSync(activeDir, { recursive: true });
  fs.writeFileSync(path.join(activeDir, live), "");
  // A marker the extension released late, and a directory the index also holds.
  fs.writeFileSync(path.join(activeDir, stopped), "");
  fs.mkdirSync(path.join(activeDir, "tool-calls"));

  const active = await readActiveExternalRuns();
  assert.deepEqual([...active.keys()], [live]);
  assert.equal(active.get(live).pidAlive, true);
});

test("a temp root whose async root does not exist is empty, not a throw", async (t) => {
  useTempRoot(t);
  assert.equal((await readActiveExternalRuns()).size, 0);
});

test("an unset temp root without a uid scope has no root to guess", (t) => {
  const previousRoot = process.env.PI_SUBAGENTS_TEMP_ROOT;
  const previousGetuid = process.getuid;
  delete process.env.PI_SUBAGENTS_TEMP_ROOT;
  // Windows has no getuid; mirror that rather than inventing a scope.
  process.getuid = undefined;
  t.after(() => {
    if (previousRoot === undefined) delete process.env.PI_SUBAGENTS_TEMP_ROOT;
    else process.env.PI_SUBAGENTS_TEMP_ROOT = previousRoot;
    process.getuid = previousGetuid;
  });

  assert.equal(resolveExternalAsyncRoot(), null);

  // With a uid to scope by, the same unset root falls back to the uid-scoped
  // directory the extension uses: resolved, and never read from here.
  process.getuid = previousGetuid;
  assert.equal(
    resolveExternalAsyncRoot(),
    path.join(os.tmpdir(), `pi-subagents-uid-${previousGetuid()}`, "async-subagent-runs"),
  );
});
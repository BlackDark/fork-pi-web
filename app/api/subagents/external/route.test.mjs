import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET } = await jiti.import("./route.ts");

/** A run directory tree like the extension writes it. */
function seedRun(root, runId, status) {
  const runDir = join(root, "async-subagent-runs", runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "status.json"), JSON.stringify(status));
  return runDir;
}

function withRoot(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-web-external-status-"));
  const previous = process.env.PI_SUBAGENTS_TEMP_ROOT;
  process.env.PI_SUBAGENTS_TEMP_ROOT = root;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_SUBAGENTS_TEMP_ROOT;
    else process.env.PI_SUBAGENTS_TEMP_ROOT = previous;
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}

test("returns the state of runs the caller names", async (t) => {
  const root = withRoot(t);
  seedRun(root, "run-live", {
    runId: "run-live",
    mode: "single",
    state: "running",
    pid: process.pid,
    currentTool: "bash",
    sessionFile: "/tmp/child.jsonl",
  });

  const response = await GET(new Request("http://localhost/api/subagents/external?runIds=run-live"));
  assert.equal(response.status, 200);
  const { runs } = await response.json();
  assert.equal(runs["run-live"].status, "running");
  assert.equal(runs["run-live"].live, true);
  assert.equal(runs["run-live"].activity.tool, "bash");
  assert.deepEqual(runs["run-live"].sessionFiles, ["/tmp/child.jsonl"]);
});

test("a partial run reads as failed but keeps its raw state", async (t) => {
  const root = withRoot(t);
  seedRun(root, "run-partial", { runId: "run-partial", mode: "workflow", state: "partial" });

  const { runs } = await (await GET(new Request("http://localhost/api/subagents/external?runIds=run-partial"))).json();
  assert.equal(runs["run-partial"].status, "failed");
  assert.equal(runs["run-partial"].rawState, "partial");
});

test("an unknown run is absent rather than an error", async (t) => {
  withRoot(t);
  const response = await GET(new Request("http://localhost/api/subagents/external?runIds=nope"));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).runs, {});
});

test("a traversal attempt in runIds is dropped, not joined into a path", async (t) => {
  withRoot(t);
  const response = await GET(new Request("http://localhost/api/subagents/external?runIds=..%2F..%2Fetc"));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).runs, {});
});

test("with no runIds it reports only the runs marked live", async (t) => {
  const root = withRoot(t);
  seedRun(root, "run-active", { runId: "run-active", mode: "single", state: "running" });
  seedRun(root, "run-done", { runId: "run-done", mode: "single", state: "complete" });
  mkdirSync(join(root, "async-subagent-runs", ".active-runs"), { recursive: true });
  writeFileSync(join(root, "async-subagent-runs", ".active-runs", "run-active"), "");

  const { runs } = await (await GET(new Request("http://localhost/api/subagents/external?active=1"))).json();
  // The finished run is not polled: the run directory is unbounded, so only
  // what the extension itself marks live is ever read.
  assert.deepEqual(Object.keys(runs), ["run-active"]);
});

test("an absent temp root is an empty result, not a failure", async () => {
  const previous = process.env.PI_SUBAGENTS_TEMP_ROOT;
  process.env.PI_SUBAGENTS_TEMP_ROOT = join(tmpdir(), "pi-web-does-not-exist-xyz");
  try {
    const response = await GET(new Request("http://localhost/api/subagents/external?active=1"));
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).runs, {});
  } finally {
    if (previous === undefined) delete process.env.PI_SUBAGENTS_TEMP_ROOT;
    else process.env.PI_SUBAGENTS_TEMP_ROOT = previous;
  }
});

test("matches a run to the caller's session files even when they resolve differently", async (t) => {
  const root = withRoot(t);
  const childDir = join(root, "child");
  mkdirSync(childDir, { recursive: true });
  const childFile = join(childDir, "session.jsonl");
  writeFileSync(childFile, "{}\n");
  // A symlinked spelling of the same file must still match.
  const linkedDir = join(root, "linked");
  symlinkSync(childDir, linkedDir);

  seedRun(root, "run-match", {
    runId: "run-match",
    mode: "single",
    state: "running",
    sessionFile: childFile,
  });
  // active=1 only reports runs the extension currently marks live.
  mkdirSync(join(root, "async-subagent-runs", ".active-runs"), { recursive: true });
  writeFileSync(join(root, "async-subagent-runs", ".active-runs", "run-match"), "");

  const viaReal = await (await GET(new Request(`http://localhost/api/subagents/external?active=1&paths=${encodeURIComponent(childFile)}`))).json();
  assert.deepEqual(Object.keys(viaReal.runs), ["run-match"]);

  const viaLink = await (await GET(new Request(`http://localhost/api/subagents/external?active=1&paths=${encodeURIComponent(join(linkedDir, "session.jsonl"))}`))).json();
  assert.deepEqual(Object.keys(viaLink.runs), ["run-match"], "a symlinked spelling of the same file must still match");

  const unrelated = await (await GET(new Request("http://localhost/api/subagents/external?active=1&paths=/tmp/somewhere-else.jsonl"))).json();
  assert.deepEqual(unrelated.runs, {});
});

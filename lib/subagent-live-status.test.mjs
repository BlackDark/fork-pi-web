import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
// One module instance: the store is a singleton by design, and every test below
// releases its watches, so the state does not leak between cases.
const store = await jiti.import("./subagent-live-status.ts");

/** Answer `statusById` for the next tick, recording which runs were requested. */
function stubStatus(statusById) {
  const requested = [];
  globalThis.fetch = async (url) => {
    const id = decodeURIComponent(String(url).split("/").pop());
    requested.push(id);
    const status = statusById[id];
    return {
      ok: status !== undefined,
      status: status === undefined ? 404 : 200,
      json: async () => (status === undefined ? { error: "Subagent not found" } : { run: { status } }),
    };
  };
  return requested;
}

/** Requests for one run only, so another test's leftovers cannot blur a count. */
function forId(requested, id) {
  return requested.filter((entry) => entry === id);
}

/**
 * One deterministic tick. Subscribing starts a tick without awaiting, and the
 * in-flight guard makes a concurrent tick a no-op, so let that one settle first.
 */
async function tick() {
  await new Promise((resolve) => setImmediate(resolve));
  await store.pollSubagentStatusOnce();
}

test("a tick publishes the server's status for a watched run", async () => {
  store.resetSubagentStatusStore();
  stubStatus({ child: "running" });
  const seen = [];
  const unsubscribe = store.subscribeSubagentStatus(() => seen.push(store.getSubagentStatusSnapshot().get("child")));
  const stop = store.watchSubagentStatus("child");

  await tick();
  assert.ok(seen.includes("running"), `expected a published status, saw ${JSON.stringify(seen)}`);

  stop();
  unsubscribe();
});

test("a settled run is no longer watched", async () => {
  store.resetSubagentStatusStore();
  stubStatus({ child: "completed" });
  const stop = store.watchSubagentStatus("child");
  await tick();
  assert.equal(store.getSubagentStatusSnapshot().get("child"), "completed");

  const afterSettle = globalThis.fetch;
  stubStatus({ child: "completed" });
  const requested = [];
  globalThis.fetch = async (url) => { requested.push(url); return afterSettle(url); };
  await tick();
  // A settled run must stop costing requests, or an old session pins a poller
  // open for as long as the page lives.
  assert.deepEqual(requested, []);
  stop();
});

test("an interrupted run keeps its status instead of reverting to the catalogue", async () => {
  store.resetSubagentStatusStore();
  // The session file still says "running"; discarding the server's answer would
  // put that stale value back on screen.
  stubStatus({ child: "interrupted" });
  const stop = store.watchSubagentStatus("child");
  await tick();
  assert.equal(store.getSubagentStatusSnapshot().get("child"), "interrupted");
  stop();
});

test("an unreachable run leaves the caller's fallback in place", async () => {
  store.resetSubagentStatusStore();
  stubStatus({});
  const stop = store.watchSubagentStatus("child");
  await tick();
  assert.equal(store.getSubagentStatusSnapshot().get("child"), undefined);
  stop();
});

test("two watchers of one run cost a single request", async () => {
  store.resetSubagentStatusStore();
  const requested = stubStatus({ shared: "running" });
  const stopA = store.watchSubagentStatus("shared");
  const stopB = store.watchSubagentStatus("shared");
  await tick();
  // The invariant is one request per run per tick, not one per watcher. The
  // exact count can exceed one because subscribing starts a tick immediately.
  assert.equal(new Set(requested).size, 1, `expected one request for "shared", got ${JSON.stringify(requested)}`);
  stopA();
  stopB();
});

test("releasing the last watcher stops the poller and a re-watch restarts it", async () => {
  store.resetSubagentStatusStore();
  stubStatus({ relaunch: "running" });
  const stopOne = store.watchSubagentStatus("relaunch");
  await tick();

  stopOne();
  stopOne();
  const fresh = stubStatus({ relaunch: "running" });
  const stopAgain = store.watchSubagentStatus("relaunch");
  await tick();
  assert.equal(forId(fresh, "relaunch").length >= 1, true, "a re-watch must be polled again");
  stopAgain();
});

test("one holder releasing does not cancel another holder's watch", async () => {
  store.resetSubagentStatusStore();
  // The Agents panel and a transcript row can watch the same run; whichever
  // unmounts first must leave the other one live.
  stubStatus({ joint: "running" });
  const stopPanel = store.watchSubagentStatus("joint");
  const stopRow = store.watchSubagentStatus("joint");
  await tick();

  stopPanel();
  const fresh = stubStatus({ joint: "running" });
  await tick();
  assert.equal(forId(fresh, "joint").length, 1, "the surviving holder must still be polled");
  stopRow();
});

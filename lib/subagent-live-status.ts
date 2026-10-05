"use client";

import { fetchExternalRuns, fetchSubagentStatus, type ExternalRunView } from "./subagent-client";
import type { SubagentSessionStatus } from "./types";

const POLL_MS = 2_000;

const TERMINAL: ReadonlySet<SubagentSessionStatus> = new Set([
  "completed", "failed", "aborted", "interrupted",
]);

/**
 * A run is dropped after this many unanswered ticks. The server forgets a run
 * once it has left the in-memory map and answers 404 from then on, so without
 * this the poller would follow every finished run forever — a settled page
 * would keep re-reading the whole session tree twice a second.
 */
const MAX_MISSES = 3;

/**
 * Live status for sub-agent runs, shared by every surface that shows one (the
 * Agents panel rows, the sidebar family chip, the transcript activity row).
 *
 * One module-level poller serves all of them. A per-component interval would
 * mean one timer per row for the cost of the same requests, and each would keep
 * ticking after its run settled.
 *
 * The catalogue cannot answer this. A background run's tool result is written
 * once at dispatch and never revised — completion arrives as a separate
 * transcript message — so a snapshot read from a session file says "running"
 * for the rest of time. It also cannot notice a run whose process died, which
 * the server reports as "interrupted". Only the server knows.
 *
 * Terminal statuses are dropped from the watch set, so polling stops on its own
 * once a run has finished, and the set is empty on a settled page.
 */
const statuses = new Map<string, SubagentSessionStatus>();
// Refcounted: the Agents panel and a transcript row can watch the same run, and
// the first of them to unmount must not cancel the other's watch.
const watching = new Map<string, number>();
/** Consecutive ticks that answered nothing, per run. */
const missCounts = new Map<string, number>();
const listeners = new Set<() => void>();
const externalListeners = new Set<() => void>();
let snapshot: ReadonlyMap<string, SubagentSessionStatus> = new Map();
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

function publish(): void {
  snapshot = new Map(statuses);
  for (const listener of listeners) listener();
}

function stopTimer(): void {
  if (timer === null) return;
  clearInterval(timer);
  timer = null;
}

/** One tick. Exported so tests can drive the poller without timers. */
export async function pollSubagentStatusOnce(): Promise<void> {
  // A slow tick must not stack fetches behind itself.
  if (inFlight || watching.size === 0 || (typeof document !== "undefined" && document.visibilityState === "hidden")) return;
  inFlight = true;
  const ids = [...watching.keys()];
  try {
    const results = await Promise.all(ids.map(async (id) => [id, await fetchSubagentStatus(id)] as const));
    for (const [id, status] of results) {
      if (!status) {
        // No answer. A transient failure must not be read as "gone", but a run
        // the server has forgotten must not be re-read on every tick either.
        const misses = (missCounts.get(id) ?? 0) + 1;
        missCounts.set(id, misses);
        if (misses >= MAX_MISSES) watching.delete(id);
        continue;
      }
      missCounts.delete(id);
      // The settled status is kept, not dropped: it is what corrects a stale
      // "running" in the session file, and the catalogue would say "running"
      // again if it were discarded. Only the watch stops.
      statuses.set(id, status);
      if (TERMINAL.has(status)) watching.delete(id);
    }
    publish();
  } finally {
    inFlight = false;
    if (watching.size === 0) stopTimer();
  }
}

function ensureTimer(): void {
  if (timer !== null || watching.size === 0) return;
  void pollSubagentStatusOnce();
  timer = setInterval(() => { void pollSubagentStatusOnce(); }, POLL_MS);
}

/**
 * Clear all state. Test seam only: the store is a module singleton, so a test
 * file cannot otherwise assert on an empty watch set.
 */
export function resetSubagentStatusStore(): void {
  stopTimer();
  if (externalTimer !== null) { clearInterval(externalTimer); externalTimer = null; }
  externalWatchers = 0;
  externalInFlight = false;
  externalByRunId.clear();
  externalBySessionPath.clear();
  externalSnapshot = { byRunId: new Map(), bySessionPath: new Map() };
  inFlight = false;
  watching.clear();
  statuses.clear();
  missCounts.clear();
  snapshot = new Map();
}

/** Subscribe to status updates. Returns an unsubscribe function. */
export function subscribeSubagentStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The current snapshot; a new Map identity only after a real update. */
export function getSubagentStatusSnapshot(): ReadonlyMap<string, SubagentSessionStatus> {
  return snapshot;
}

/**
 * Keep one run's status fresh until it settles. Returns an unsubscribe
 * function; the status map is keyed by session id and shared, so two callers
 * watching the same run cost one request.
 */
export function watchSubagentStatus(sessionId: string): () => void {
  watching.set(sessionId, (watching.get(sessionId) ?? 0) + 1);
  ensureTimer();
  let released = false;
  return () => {
    // Release once even if a holder unsubscribes twice, and tear the poller down
    // as soon as the last watcher lets go: an interval nobody clears keeps
    // firing forever and keeps the host process alive.
    if (released) return;
    released = true;
    const remaining = (watching.get(sessionId) ?? 1) - 1;
    if (remaining > 0) watching.set(sessionId, remaining);
    else {
      watching.delete(sessionId);
      missCounts.delete(sessionId);
    }
    if (watching.size === 0) stopTimer();
  };
}

/**
 * Runs persisted by another sub-agent extension, kept beside the in-process
 * ones because the sidebar, the dock and the transcript all want to show a
 * child the same way regardless of which runtime started it.
 *
 * Unlike the in-process poller this asks for whatever that extension currently
 * marks live rather than watching named ids: its run directory grows without
 * bound, so it is never enumerated. Terminal runs are picked up once and then
 * left alone, which is exactly what a settled child needs.
 */
const externalByRunId = new Map<string, ExternalRunView>();
const externalBySessionPath = new Map<string, ExternalRunView>();
let externalSnapshot: {
  byRunId: ReadonlyMap<string, ExternalRunView>;
  bySessionPath: ReadonlyMap<string, ExternalRunView>;
} = { byRunId: new Map(), bySessionPath: new Map() };
let externalTimer: ReturnType<typeof setInterval> | null = null;
let externalWatchers = 0;
let externalInFlight = false;

function publishExternal(): void {
  externalSnapshot = { byRunId: new Map(externalByRunId), bySessionPath: new Map(externalBySessionPath) };
  for (const listener of externalListeners) listener();
}

async function pollExternal(): Promise<void> {
  if (externalInFlight) return;
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
  externalInFlight = true;
  try {
    const { byRunId, bySessionPath } = await fetchExternalRuns();
    for (const [runId, run] of byRunId) {
      // A settled run is recorded and then ignored: its file stops changing.
      if (!run.live && externalByRunId.has(runId)) continue;
      externalByRunId.set(runId, run);
    }
    for (const [sessionPath, run] of bySessionPath) externalBySessionPath.set(sessionPath, run);
    publishExternal();
  } catch {
    // Best effort; the caller keeps what it had.
  } finally {
    externalInFlight = false;
  }
}

export function subscribeExternalRuns(listener: () => void): () => void {
  externalListeners.add(listener);
  return () => { externalListeners.delete(listener); };
}

export function getExternalRunSnapshot(): typeof externalSnapshot {
  return externalSnapshot;
}

/** Begin following live runs. The poller stops once every caller has let go. */
export function watchExternalRuns(): () => void {
  externalWatchers += 1;
  if (externalTimer === null) {
    void pollExternal();
    externalTimer = setInterval(() => { void pollExternal(); }, POLL_MS);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    externalWatchers -= 1;
    if (externalWatchers === 0 && externalTimer !== null) {
      clearInterval(externalTimer);
      externalTimer = null;
    }
  };
}

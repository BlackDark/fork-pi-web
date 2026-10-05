// Client-side helper for /api/subagents/[id].
//
// The route already implements everything a user can do to a run from a TUI
// (read its live state, steer it, stop it), but nothing in the UI called it, so
// the browser could only ever show the status persisted in the catalogue. That
// status goes stale: a run whose process died keeps saying "running" forever.
// Reading through here applies the server's own `settleOrphanedRun`, which
// reports those as "interrupted".

import type { SubagentSessionStatus } from "./types";

/** Statuses a run can still leave. Only these are worth re-reading from the server. */
const LIVE_STATUSES = new Set<SubagentSessionStatus>(["starting", "queued", "running"]);

export function isLiveSubagentStatus(status: SubagentSessionStatus): boolean {
  return LIVE_STATUSES.has(status);
}

interface RunResponse {
  run?: { status?: SubagentSessionStatus };
  error?: string;
}

async function post(sessionId: string, body: Record<string, unknown>): Promise<RunResponse> {
  const response = await fetch(`/api/subagents/${encodeURIComponent(sessionId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as RunResponse;
  if (!response.ok) throw new Error(payload.error ?? `Sub-agent request failed (${response.status})`);
  return payload;
}

/**
 * The server's live status for one run, or null when it cannot be reached.
 * A failure is never fatal: the caller keeps the catalogue status, which is
 * right for every terminal run and merely optimistic for a live one.
 */
export async function fetchSubagentStatus(sessionId: string): Promise<SubagentSessionStatus | null> {
  try {
    const response = await fetch(`/api/subagents/${encodeURIComponent(sessionId)}`, { cache: "no-store" });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => ({})) as RunResponse;
    return payload.run?.status ?? null;
  } catch {
    return null;
  }
}

export async function steerSubagentRun(sessionId: string, message: string): Promise<void> {
  await post(sessionId, { action: "steer", message });
}

export async function abortSubagentRun(sessionId: string): Promise<void> {
  await post(sessionId, { action: "abort" });
}

/** A run another extension persisted, as pi-web needs it. */
export interface ExternalRunView {
  runId: string;
  status: SubagentSessionStatus;
  rawState?: string;
  live: boolean;
  activity?: { tool?: string; path?: string; state?: string; turnCount?: number; toolCount?: number };
  error?: string;
}

interface ExternalResponse {
  runs?: Record<string, {
    status?: SubagentSessionStatus;
    rawState?: string;
    live?: boolean;
    activity?: ExternalRunView["activity"];
    error?: string;
    sessionFiles?: string[];
  }>;
}

/**
 * Runs persisted by another extension, keyed by run id and by the child's
 * session FILE path. `runIds` empty asks for whatever that extension currently
 * marks live, which is bounded; its run directory is never enumerated because
 * it grows without bound and is reaped underneath us.
 */
export async function fetchExternalRuns(
  runIds?: readonly string[],
  sessionPaths?: readonly string[],
): Promise<{
  byRunId: Map<string, ExternalRunView>;
  bySessionPath: Map<string, ExternalRunView>;
}> {
  const params = new URLSearchParams();
  if (runIds?.length) params.set("runIds", runIds.join(","));
  else params.set("active", "1");
  // Naming the paths lets the server canonicalise them; the browser cannot
  // canonicalise its own copy, and the two spellings differ under a symlink.
  if (sessionPaths?.length) params.set("paths", sessionPaths.join(","));
  const query = params.toString();
  const response = await fetch(`/api/subagents/external?${query}`, { cache: "no-store" });
  if (!response.ok) return { byRunId: new Map(), bySessionPath: new Map() };
  const payload = await response.json().catch(() => ({})) as ExternalResponse;
  const byRunId = new Map<string, ExternalRunView>();
  const bySessionPath = new Map<string, ExternalRunView>();
  for (const [runId, run] of Object.entries(payload.runs ?? {})) {
    if (!run.status) continue;
    const view: ExternalRunView = {
      runId,
      status: run.status,
      live: run.live === true,
      ...(run.rawState ? { rawState: run.rawState } : {}),
      ...(run.activity ? { activity: run.activity } : {}),
      ...(run.error ? { error: run.error } : {}),
    };
    byRunId.set(runId, view);
    // Later runs win for a session: a resumed run is the current one.
    for (const sessionFile of run.sessionFiles ?? []) bySessionPath.set(sessionFile, view);
  }
  return { byRunId, bySessionPath };
}

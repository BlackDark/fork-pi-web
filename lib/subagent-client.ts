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
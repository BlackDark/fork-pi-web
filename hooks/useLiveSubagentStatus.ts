"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  getExternalRunSnapshot,
  getSubagentStatusSnapshot,
  subscribeExternalRuns,
  subscribeSubagentStatus,
  watchExternalRuns,
  watchSubagentStatus,
} from "@/lib/subagent-live-status";
import type { ExternalRunView } from "@/lib/subagent-client";
import type { SubagentSessionStatus } from "@/lib/types";

function useSubagentStatusSnapshot(): ReadonlyMap<string, SubagentSessionStatus> {
  return useSyncExternalStore(
    subscribeSubagentStatus,
    getSubagentStatusSnapshot,
    getSubagentStatusSnapshot,
  );
}

/**
 * Subscribe to one run's live status, or undefined when the server has not said
 * anything about it yet and the caller should fall back to the catalogue.
 */
export function useLiveSubagentStatus(sessionId: string | null | undefined): SubagentSessionStatus | undefined {
  useEffect(() => {
    if (!sessionId) return;
    return watchSubagentStatus(sessionId);
  }, [sessionId]);

  const snapshot = useSubagentStatusSnapshot();
  return sessionId ? snapshot.get(sessionId) : undefined;
}

/**
 * Subscribe to several runs at once through the one shared poller, so a family
 * of children costs one interval rather than one per row.
 */
export function useLiveSubagentStatuses(sessionIds: readonly string[]): ReadonlyMap<string, SubagentSessionStatus> {
  const key = [...sessionIds].sort().join(",");
  useEffect(() => {
    if (key === "") return;
    const unsubscribes = key.split(",").map((id) => watchSubagentStatus(id));
    return () => { for (const unsubscribe of unsubscribes) unsubscribe(); };
  }, [key]);

  return useSubagentStatusSnapshot();
}

/**
 * Follow the runs another sub-agent extension persisted, keyed by run id and by
 * the child's session file path. Both maps are empty when that extension is not
 * installed or has nothing live, which is the common case.
 */
export function useExternalSubagentRuns(): {
  byRunId: ReadonlyMap<string, ExternalRunView>;
  bySessionPath: ReadonlyMap<string, ExternalRunView>;
} {
  useEffect(() => watchExternalRuns(), []);
  return useSyncExternalStore(
    subscribeExternalRuns,
    getExternalRunSnapshot,
    getExternalRunSnapshot,
  );
}

/** One external run by id, or undefined when it is not one we can see. */
export function useExternalRunStatus(runId: string | undefined): ExternalRunView | undefined {
  const { byRunId } = useExternalSubagentRuns();
  return runId ? byRunId.get(runId) : undefined;
}

/** One external run, identified by the child's session file path. */
export function useExternalRunStatusForSessionPath(sessionPath: string | undefined): ExternalRunView | undefined {
  const { bySessionPath } = useExternalSubagentRuns();
  return sessionPath ? bySessionPath.get(sessionPath) : undefined;
}

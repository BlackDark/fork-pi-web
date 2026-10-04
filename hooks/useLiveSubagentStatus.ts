"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  getSubagentStatusSnapshot,
  subscribeSubagentStatus,
  watchSubagentStatus,
} from "@/lib/subagent-live-status";
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

import type { SessionInfo, SubagentSessionStatus } from "./types";

/**
 * The one status worth showing on a collapsed family row, worst news first.
 *
 * A live child outranks everything because it is the only state that is still
 * changing and the one a user is waiting on. A failure outranks a plain stop
 * because it is the state that needs a decision. An interrupted child is
 * reported rather than hidden: it means a process died without writing a
 * result, which is exactly what the live-status poll exists to surface.
 */
const PRECEDENCE: readonly SubagentSessionStatus[] = [
  "starting",
  "running",
  "queued",
  "failed",
  "interrupted",
  "aborted",
  "completed",
];

/** Worst-wins across a family's children; null when the family has none. */
export function summarizeSubagentStatus(
  statuses: readonly (SubagentSessionStatus | undefined)[],
): SubagentSessionStatus | null {
  let best: SubagentSessionStatus | null = null;
  let bestRank = PRECEDENCE.length;
  for (const status of statuses) {
    if (!status) continue;
    const rank = PRECEDENCE.indexOf(status);
    if (rank === -1 || rank >= bestRank) continue;
    best = status;
    bestRank = rank;
  }
  return best;
}

/** Count and worst status for one session family's children. */
export function summarizeSubagents(subagents: readonly SessionInfo[]): {
  count: number;
  status: SubagentSessionStatus | null;
} {
  return {
    count: subagents.length,
    status: summarizeSubagentStatus(subagents.map((session) =>
      session.relation?.kind === "subagent" ? session.relation.status : undefined,
    )),
  };
}

/**
 * Shared by the sidebar family chip and the Agents panel so a run reads as the
 * same colour wherever it is summarised. Returns a CSS colour, not a class, to
 * match how these surfaces are styled inline.
 */
export function subagentStatusColor(status: SubagentSessionStatus): string {
  if (status === "starting" || status === "running") return "var(--accent)";
  if (status === "completed") return "#16a34a";
  if (status === "failed") return "#dc2626";
  if (status === "aborted" || status === "interrupted") return "#d97706";
  return "var(--text-dim)";
}

import type { SubagentToolDetails } from "./subagent-extension";
import type { SubagentSessionStatus } from "./types";

/**
 * One sub-agent run, as the UI needs it, independent of which runtime started it.
 *
 * Two runtimes are recognised. pi-web's built-in runtime reports one run with a
 * `pi-web-subagent` details object; `nicobailon/pi-subagents` reports a fan-out
 * with a `results` array. Both land in the session file's tool_result details,
 * so historical runs render from it too.
 */
export interface SubagentRunView {
  /** Stable key for React and for matching rows across renders. */
  key: string;
  /** The child's session id, when the runtime reported one. */
  sessionId?: string;
  /** Agent or profile name. */
  agent: string;
  task: string;
  status: SubagentSessionStatus;
  /** True while the runtime may still change the status. */
  live: boolean;
  runId?: string;
  /** How the run was dispatched, when the runtime reported it. */
  mode?: string;
  /** The child ran in its own worktree. */
  worktree?: boolean;
  error?: string;
  /** Display name the runtime gave the child's own session. */
  sessionName?: string;
  /** Run start, when the runtime reported one. */
  createdAt?: string;
  /** Run end, when the runtime reported one. */
  completedAt?: string;
}

/** pi-web's own runtime: one run per tool result. */
function fromBuiltIn(details: SubagentToolDetails): SubagentRunView {
  return {
    key: details.sessionId,
    sessionId: details.sessionId,
    agent: details.profile,
    task: details.description,
    status: details.status,
    live: isLive(details.status),
    worktree: Boolean(details.worktreePath),
    createdAt: details.createdAt,
    ...(details.completedAt ? { completedAt: details.completedAt } : {}),
    ...(details.error ? { error: details.error } : {}),
  };
}

/**
 * nicobailon/pi-subagents: `results` is one row per child, so a fan-out is one
 * tool result carrying many runs. There is no status field — the terminal state
 * is encoded in the exit fields, and a result row only exists once the child
 * has finished, so every mapped status is settled.
 */
function fromExternal(results: readonly unknown[], mode: string | undefined): SubagentRunView[] {
  const views: SubagentRunView[] = [];
  results.forEach((entry, position) => {
    if (!isRecord(entry)) return;
    const agent = typeof entry.agent === "string" ? entry.agent : "";
    const task = typeof entry.task === "string" ? entry.task : "";
    const sessionId = typeof entry.sessionId === "string" ? entry.sessionId : undefined;
    const runId = typeof entry.runId === "string" ? entry.runId : undefined;
    const status = externalStatus(entry);
    const sessionName = typeof entry.sessionName === "string" ? entry.sessionName : undefined;
    views.push({
      key: runId ?? sessionId ?? `${mode ?? "run"}-${position}`,
      ...(sessionId ? { sessionId } : {}),
      agent,
      task,
      status,
      // A foreground child is streamed into the conversation and its row is
      // rewritten when it settles; a detached one is not, so its result row is
      // the only completion signal pi-web will ever see.
      live: false,
      ...(runId ? { runId } : {}),
      ...(mode ? { mode } : {}),
      ...(sessionName ? { sessionName } : {}),
      ...(status === "failed" ? { error: describeExternalFailure(entry) } : {}),
    });
  });
  return views;
}

function externalStatus(entry: Record<string, unknown>): SubagentSessionStatus {
  if (entry.stopped === true) return "aborted";
  if (entry.interrupted === true) return "interrupted";
  if (entry.timedOut === true) return "failed";
  return entry.exitCode === 0 ? "completed" : "failed";
}

function describeExternalFailure(entry: Record<string, unknown>): string | undefined {
  if (entry.timedOut === true) return "Timed out";
  if (entry.processSignal) return `Killed by ${String(entry.processSignal)}`;
  const exitCode = entry.exitCode;
  return typeof exitCode === "number" ? `Exited with code ${exitCode}` : undefined;
}

function isLive(status: SubagentSessionStatus): boolean {
  return status === "starting" || status === "queued" || status === "running";
}

/**
 * The runs a tool result describes, or null when it is not a sub-agent result.
 * A `null` here is what keeps every other tool call on the generic card.
 */
export function subagentRunsFromToolResult(
  toolName: string,
  details: unknown,
): SubagentRunView[] | null {
  if (!isRecord(details)) return null;
  if (details.kind === "pi-web-subagent" && typeof details.sessionId === "string") {
    return [fromBuiltIn(details as unknown as SubagentToolDetails)];
  }
  if (toolName !== "subagent" || !Array.isArray(details.results)) return null;
  if (details.results.length === 0) return null;
  const mode = typeof details.mode === "string" ? details.mode : undefined;
  const runs = fromExternal(details.results, mode);
  return runs.length > 0 ? runs : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

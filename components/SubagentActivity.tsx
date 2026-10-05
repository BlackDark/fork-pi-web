"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useExternalRunStatus, useLiveSubagentStatus } from "@/hooks/useLiveSubagentStatus";
import { subagentStatusColor } from "@/lib/subagent-family-status";
import type { SubagentRunView } from "@/lib/subagent-tool-adapter";

const LIVE_STATUSES = new Set(["starting", "queued", "running"]);

function isLive(status: SubagentRunView["status"]): boolean {
  return LIVE_STATUSES.has(status);
}

function formatDuration(
  createdAt: string | undefined,
  completedAt: string | undefined,
  status: SubagentRunView["status"],
  now: number,
): string {
  if (!createdAt) return "";
  const start = new Date(createdAt).getTime();
  if (!Number.isFinite(start)) return "";
  // Only a live run has no completedAt, and only a live run should fall back to
  // the clock. Measuring a settled run against now() reports years for a run
  // whose result was simply never timestamped.
  // A run whose runtime never reported a start time simply shows no duration.
  const end = completedAt
    ? new Date(completedAt).getTime()
    : isLive(status) ? now : NaN;
  if (!Number.isFinite(end) || end < start) return "";
  const seconds = Math.round((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function StatusGlyph({ status }: { status: SubagentRunView["status"] }) {
  if (isLive(status)) {
    return (
      <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (status === "completed") {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m5 13 4 4L19 7" />
      </svg>
    );
  }
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2.5" />
    </svg>
  );
}

/**
 * One sub-agent run, rendered in the parent's transcript as a secondary row
 * rather than a full tool card: a fan-out of a dozen workers would otherwise
 * bury the conversation that asked for it. The status is the point of the row,
 * so it leads; the task and the worktree only appear on expand.
 */
export function SubagentActivity({
  run,
  task,
  resultText,
  expanded,
  onToggle,
  onOpenSession,
}: {
  run: SubagentRunView;
  /** From the tool input, not the details: older runs have no task in details. */
  task?: string;
  /** The tool result body. For `get_subagent_result` this is the whole point. */
  resultText?: string | null;
  expanded: boolean;
  onToggle: () => void;
  onOpenSession?: (sessionId: string) => void;
}) {
  const { t } = useI18n();
  // The persisted snapshot is written once at dispatch and never revised, so a
  // background run's row would claim "running" forever. The server is the only
  // source that can settle it.
  const liveStatus = useLiveSubagentStatus(run.sessionId);
  // A run started by another extension persists its own state; its recorded
  // status is a settled snapshot, so the live one has to come from elsewhere.
  const external = useExternalRunStatus(run.runId);
  const status = liveStatus ?? external?.status ?? run.status;
  // A live run has no completedAt, so its duration is the elapsed time and has
  // to tick; a settled row never moves again.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isLive(status)) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [status]);

  const color = subagentStatusColor(status);
  const duration = formatDuration(run.createdAt, run.completedAt, status, now);

  return (
    <div style={{ border: `1px solid ${color}33`, borderRadius: 7, background: `${color}0a`, fontSize: 12 }}>
      <div style={{ display: "flex", alignItems: "stretch", minWidth: 0 }}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          style={{
            display: "flex", alignItems: "center", gap: 7, flex: 1, minWidth: 0,
            padding: "6px 10px", background: "none", border: "none",
            color: "var(--text-muted)", cursor: "pointer", fontSize: 12, textAlign: "left",
          }}
        >
          <span style={{ color, flexShrink: 0, display: "grid", placeItems: "center" }}>
            <StatusGlyph status={status} />
          </span>
          <span style={{ color, fontWeight: 600, fontSize: 11, flexShrink: 0 }}>{run.agent}</span>
          <span
            style={{ color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}
            title={run.task || run.sessionName || ""}
          >
            {run.task || run.sessionName || run.agent}
          </span>
          {run.mode && run.mode !== "single" && (
            <span style={{ fontSize: 10, color: "var(--text-dim)", flexShrink: 0, border: "1px solid var(--border)", borderRadius: 8, padding: "0 5px" }}>
              {t(`agentSwitcher.mode.${run.mode}`)}
            </span>
          )}
          <span style={{ fontSize: 11, color, flexShrink: 0, whiteSpace: "nowrap" }}>
            {t(`agentSwitcher.status.${status}`)}
          </span>
          {external?.activity?.tool && status === "running" && (
            <span style={{ fontSize: 11, color: "var(--text-dim)", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>
              {t("agentSwitcher.workingOn", { tool: external.activity.tool })}
            </span>
          )}
          {duration && (
            <span style={{ fontSize: 11, color: "var(--text-dim)", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{duration}</span>
          )}
          <svg
            width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--text-dim)"
            strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
            style={{ flexShrink: 0, transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}
          >
            <polyline points="2 3.5 5 6.5 8 3.5" />
          </svg>
        </button>
        {onOpenSession && run.sessionId && (
          <button
            type="button"
            onClick={() => { if (run.sessionId) onOpenSession(run.sessionId); }}
            title={t("subagent.open")}
            aria-label={t("subagent.open")}
            style={{ width: 32, display: "grid", placeItems: "center", border: "none", borderLeft: "1px solid var(--border)", background: "none", color: "var(--text-muted)", cursor: "pointer", flexShrink: 0 }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            </svg>
          </button>
        )}
      </div>
      {expanded && (
        <div style={{ padding: "8px 10px", borderTop: `1px solid ${color}26`, display: "grid", gap: 6 }}>
          {task && <Field label={t("agentSwitcher.task")} value={task} />}
          {resultText?.trim() && (
            <pre
              style={{
                margin: 0, padding: "6px 8px", maxHeight: 320, overflow: "auto",
                background: "var(--bg-subtle)", border: `1px solid ${color}26`, borderRadius: 6,
                color: "var(--text-muted)", fontSize: 11, lineHeight: 1.5,
                whiteSpace: "pre-wrap", wordBreak: "break-word",
              }}
            >
              {resultText}
            </pre>
          )}
          {run.worktree && <Field label={t("agentSwitcher.worktree")} value={t("agentSwitcher.ownWorktree")} />}
          {run.error && <Field label={t("agentSwitcher.error")} value={run.error} danger />}
        </div>
      )}
    </div>
  );
}

function Field({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div style={{ display: "grid", gap: 2 }}>
      <span style={{ fontSize: 10, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</span>
      <span style={{ fontSize: 11, color: danger ? "#dc2626" : "var(--text-muted)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{value}</span>
    </div>
  );
}

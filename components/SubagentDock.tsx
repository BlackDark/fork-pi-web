"use client";

import { useCallback, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useLiveSubagentStatuses } from "@/hooks/useLiveSubagentStatus";
import { isLiveSubagentStatus } from "@/lib/subagent-client";
import { abortSubagentRun, steerSubagentRun } from "@/lib/subagent-client";
import { subagentStatusColor } from "@/lib/subagent-family-status";
import type { SessionInfo, SubagentSessionStatus } from "@/lib/types";

/**
 * Every sub-agent of the selected session, docked beside the file and terminal
 * tabs.
 *
 * This is a peer of those tabs rather than a dropdown: it keeps its own state
 * while another tab is active, so watching a fan-out never takes the
 * conversation away from you, and it never covers the chat.
 */

type StatusFilter = SubagentSessionStatus | "all";

/** Order the groups read best in: what needs attention first. */
const GROUP_ORDER: readonly SubagentSessionStatus[] = [
  "running", "starting", "queued", "failed", "interrupted", "aborted", "completed",
];

const FILTERS: readonly StatusFilter[] = ["all", ...GROUP_ORDER];

function relativeTime(value: string, locale: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "";
  const minutes = Math.round((timestamp - Date.now()) / 60000);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  return formatter.format(Math.round(hours / 24), "day");
}

export function SubagentDock({
  rootSession,
  subagents,
  runningSessionIds,
  onSelectSession,
}: {
  rootSession: SessionInfo;
  subagents: SessionInfo[];
  runningSessionIds: ReadonlySet<string>;
  onSelectSession: (session: SessionInfo) => void;
}) {
  const { locale, t } = useI18n();
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Only runs the catalogue still calls live are watched, so a settled family
  // costs nothing to keep open.
  const liveIds = useMemo(
    () => subagents
      .filter((session) => session.relation?.kind === "subagent" && isLiveSubagentStatus(session.relation.status))
      .map((session) => session.id),
    [subagents],
  );
  const liveStatuses = useLiveSubagentStatuses(liveIds);

  const statusOf = useCallback((session: SessionInfo): SubagentSessionStatus => {
    if (runningSessionIds.has(session.id)) return "running";
    if (session.relation?.kind !== "subagent") return "completed";
    return liveStatuses.get(session.id) ?? session.relation.status;
  }, [liveStatuses, runningSessionIds]);

  const rows = useMemo(() => subagents.map((session) => ({
    session,
    status: statusOf(session),
  })), [statusOf, subagents]);

  const counts = useMemo(() => {
    const tally = new Map<SubagentSessionStatus, number>();
    for (const row of rows) tally.set(row.status, (tally.get(row.status) ?? 0) + 1);
    return tally;
  }, [rows]);

  const visible = useMemo(() => rows
    .filter((row) => filter === "all" || row.status === filter)
    // Live first, then most recently active: the rest is settled history.
    .sort((a, b) => {
      const aLive = a.status === "running" || a.status === "starting" || a.status === "queued";
      const bLive = b.status === "running" || b.status === "starting" || b.status === "queued";
      if (aLive !== bLive) return aLive ? -1 : 1;
      return b.session.modified.localeCompare(a.session.modified);
    }), [filter, rows]);

  const selected = rows.find((row) => row.session.id === selectedId) ?? null;
  const selectedIsLive = selected ? isLiveSubagentStatus(selected.status) : false;

  const sendSteer = async () => {
    if (!selected) return;
    const message = draft.trim();
    if (!message) return;
    setError(null);
    try {
      await steerSubagentRun(selected.session.id, message);
      setDraft("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  return (
    <div style={{ height: "100%", display: "flex", minHeight: 0 }}>
      <div style={{ width: "46%", minWidth: 200, maxWidth: 420, display: "flex", flexDirection: "column", minHeight: 0, borderRight: "1px solid var(--border)" }}>
        <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)", display: "flex", flexWrap: "wrap", gap: 4 }}>
          {FILTERS.filter((option) => option === "all" || (counts.get(option) ?? 0) > 0).map((option) => {
            const active = filter === option;
            const label = option === "all"
              ? t("agentSwitcher.allStatuses", { count: rows.length })
              : t(`agentSwitcher.status.${option}`);
            return (
              <button
                key={option}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(option)}
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  height: 22, padding: "0 7px",
                  border: active ? "1px solid var(--accent)" : "1px solid var(--border)", borderRadius: 11,
                  background: active ? "var(--bg-selected)" : "var(--bg)",
                  color: option === "all" ? "var(--text-muted)" : subagentStatusColor(option),
                  fontSize: 11, cursor: "pointer", whiteSpace: "nowrap",
                }}
              >
                <span>{label}</span>
                {option !== "all" && (
                  <span style={{ fontVariantNumeric: "tabular-nums", opacity: 0.75 }}>{counts.get(option)}</span>
                )}
              </button>
            );
          })}
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          {visible.length === 0 && (
            <p style={{ padding: "18px 12px", color: "var(--text-dim)", fontSize: 12, textAlign: "center" }}>
              {t("agentSwitcher.noChildren")}
            </p>
          )}
          {visible.map(({ session, status }) => {
            const relation = session.relation?.kind === "subagent" ? session.relation : null;
            const active = session.id === selectedId;
            return (
              <button
                key={session.id}
                type="button"
                onClick={() => setSelectedId(session.id)}
                onDoubleClick={() => onSelectSession(session)}
                aria-current={active ? "true" : undefined}
                style={{
                  width: "100%", display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto",
                  alignItems: "center", gap: 8, textAlign: "left",
                  padding: "7px 10px", border: "none",
                  borderBottom: "1px solid var(--border)",
                  borderLeft: active ? "2px solid var(--accent)" : "2px solid transparent",
                  background: active ? "var(--bg-selected)" : "transparent",
                  color: "var(--text)", cursor: "pointer",
                }}
              >
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: active ? 600 : 500 }}>
                    {relation?.description || session.name || session.firstMessage || session.id.slice(0, 12)}
                  </span>
                  <span style={{ display: "block", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-dim)", fontSize: 11 }}>
                    {relation?.profile ? `${relation.profile} · ${relativeTime(session.modified, locale)}` : relativeTime(session.modified, locale)}
                  </span>
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 4, color: subagentStatusColor(status), fontSize: 11, whiteSpace: "nowrap" }}>
                  {t(`agentSwitcher.status.${status}`)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
        {!selected && (
          <p style={{ padding: "18px 14px", color: "var(--text-dim)", fontSize: 12 }}>
            {t("agentSwitcher.selectChild")}
          </p>
        )}
        {selected && (() => {
          const relation = selected.session.relation?.kind === "subagent" ? selected.session.relation : null;
          return (
            <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10, minHeight: 0, overflowY: "auto" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <strong style={{ fontSize: 13 }}>{relation?.profile || t("agentSwitcher.subagent")}</strong>
                <span style={{ color: subagentStatusColor(selected.status), fontSize: 12 }}>
                  {t(`agentSwitcher.status.${selected.status}`)}
                </span>
                <button
                  type="button"
                  onClick={() => onSelectSession(selected.session)}
                  style={{ marginLeft: "auto", height: 24, padding: "0 9px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text-muted)", fontSize: 11, cursor: "pointer" }}
                >
                  {t("agentSwitcher.openTranscript")}
                </button>
              </div>
              <p style={{ margin: 0, color: "var(--text-dim)", fontSize: 11 }}>{rootSession.name || rootSession.firstMessage}</p>
              <Field label={t("agentSwitcher.task")} value={relation?.description || selected.session.firstMessage} />
              {selectedIsLive ? (
                <>
                  <input
                    type="text"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void sendSteer(); } }}
                    placeholder={t("agentSwitcher.steerPlaceholder")}
                    aria-label={t("agentSwitcher.steerPlaceholder")}
                    style={{ height: 30, padding: "0 9px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none" }}
                  />
                  <div>
                    <button
                      type="button"
                      onClick={() => { setError(null); void abortSubagentRun(selected.session.id).catch((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure))); }}
                      style={{ height: 26, padding: "0 10px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "#dc2626", fontSize: 11, cursor: "pointer" }}
                    >
                      {t("agentSwitcher.stop")}
                    </button>
                  </div>
                </>
              ) : null}
              {error && <p style={{ margin: 0, color: "#dc2626", fontSize: 11 }}>{error}</p>}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "grid", gap: 3 }}>
      <span style={{ fontSize: 10, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</span>
      <span style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{value}</span>
    </div>
  );
}

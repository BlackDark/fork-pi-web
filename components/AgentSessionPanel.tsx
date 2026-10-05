"use client";

import { useCallback, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useLiveSubagentStatuses } from "@/hooks/useLiveSubagentStatus";
import { abortSubagentRun, steerSubagentRun } from "@/lib/subagent-client";
import { subagentStatusColor } from "@/lib/subagent-family-status";
import { isLiveSubagentStatus } from "@/lib/subagent-client";
import type { SessionInfo, SubagentSessionStatus } from "@/lib/types";

interface Props {
  rootSession: SessionInfo;
  subagents: SessionInfo[];
  selectedSessionId: string;
  runningSessionIds: ReadonlySet<string>;
  onSelectSession: (session: SessionInfo) => void;
}

/** A run is stoppable or steerable only while the server still has it live. */
function isLive(status: SubagentSessionStatus): boolean {
  return status === "starting" || status === "queued" || status === "running";
}

function sessionTitle(session: SessionInfo): string {
  return session.name || session.firstMessage || session.id.slice(0, 12);
}

function formatRelativeTime(value: string, locale: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "";
  const elapsedSeconds = Math.round((timestamp - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (Math.abs(elapsedSeconds) < 60) return formatter.format(elapsedSeconds, "second");
  const elapsedMinutes = Math.round(elapsedSeconds / 60);
  if (Math.abs(elapsedMinutes) < 60) return formatter.format(elapsedMinutes, "minute");
  const elapsedHours = Math.round(elapsedMinutes / 60);
  if (Math.abs(elapsedHours) < 24) return formatter.format(elapsedHours, "hour");
  return formatter.format(Math.round(elapsedHours / 24), "day");
}


function StatusIcon({ status }: { status: SubagentSessionStatus }) {
  if (status === "running" || status === "starting") {
    return (
      <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.25" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  if (status === "failed") {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" /><path d="m9 9 6 6M15 9l-6 6" />
      </svg>
    );
  }
  if (status === "aborted" || status === "interrupted") {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" /><path d="M9 9h6v6H9z" />
      </svg>
    );
  }
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" />
    </svg>
  );
}

function AgentRow({
  session,
  main,
  selected,
  running,
  status,
  onSelect,
  onStop,
}: {
  session: SessionInfo;
  main?: boolean;
  selected: boolean;
  running: boolean;
  status: SubagentSessionStatus;
  onSelect: () => void;
  onStop?: () => void;
}) {
  const { locale, t } = useI18n();
  const [steering, setSteering] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const relation = session.relation?.kind === "subagent" ? session.relation : null;
  const primary = main ? t("agentSwitcher.main") : relation?.description || sessionTitle(session);
  const secondary = main
    ? sessionTitle(session)
    : `${relation?.profile ?? t("agentSwitcher.subagent")} · ${formatRelativeTime(session.modified, locale)}`;
  const canControl = !main && isLive(status);

  const sendSteer = async () => {
    const message = draft.trim();
    if (!message) return;
    setError(null);
    try {
      await steerSubagentRun(session.id, message);
      setDraft("");
      setSteering(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };


  const stop = async () => {
    setError(null);
    try {
      await onStop?.();
    } catch (failure) {
      // A run can settle between the render and the click; say so instead of
      // dropping an unhandled rejection.
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  const controlButton = (
    label: string, onClick: () => void, glyph: React.ReactNode, danger = false,
  ) => (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(event) => { event.stopPropagation(); onClick(); }}
      style={{
        display: "grid", placeItems: "center", width: 24, height: 24, padding: 0,
        border: "1px solid var(--border)", borderRadius: 6,
        background: "var(--bg)", color: danger ? "#dc2626" : "var(--text-muted)", cursor: "pointer",
      }}
    >
      {glyph}
    </button>
  );

  return (
    <div style={{ borderBottom: "1px solid var(--border)", background: selected ? "var(--bg-selected)" : "transparent" }}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center" }}>
        <button
          type="button"
          aria-current={selected ? "true" : undefined}
          onClick={onSelect}
          style={{
            minHeight: 56,
            display: "grid",
            gridTemplateColumns: "28px minmax(0, 1fr) auto",
            alignItems: "center",
            gap: 9,
            padding: "7px 12px",
            border: "none",
            borderLeft: selected ? "2px solid var(--accent)" : "2px solid transparent",
            background: "transparent",
            color: "var(--text)",
            cursor: "pointer",
            textAlign: "left",
          }}
          onMouseEnter={(event) => {
            if (!selected) event.currentTarget.style.background = "var(--bg-hover)";
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.background = "transparent";
          }}
        >
          <span style={{ width: 28, height: 28, display: "grid", placeItems: "center", color: main ? "var(--text-muted)" : "var(--accent)" }}>
            {main ? (
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" />
              </svg>
            ) : (
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="5" y="7" width="14" height="11" rx="2" /><path d="M9 11h.01M15 11h.01M9 15h6M12 7V4M10 4h4" />
              </svg>
            )}
          </span>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: selected ? 600 : 500 }} title={primary}>
              {primary}
            </span>
            <span style={{ display: "block", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-dim)", fontSize: 11 }} title={secondary}>
              {secondary}
            </span>
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 6, color: main && !running ? "var(--text-dim)" : subagentStatusColor(status), fontSize: 11, whiteSpace: "nowrap" }}>
            {main && !running ? (
              selected ? t("agentSwitcher.current") : null
            ) : (
              <>
                <StatusIcon status={status} />
                <span>{t(`agentSwitcher.status.${status}`)}</span>
              </>
            )}
          </span>
        </button>
        {canControl && (
          <div style={{ display: "flex", gap: 4, paddingRight: 10 }}>
            {controlButton(
              steering ? t("agentSwitcher.steerCancel") : t("agentSwitcher.steer"),
              () => { setSteering((value) => !value); setError(null); },
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 20h16M4 20l4-4M4 20l2-6M20 4l-4 4M20 4l-2 6M20 4H9" />
              </svg>,
            )}
            {onStop && controlButton(
              t("agentSwitcher.stop"),
              () => { void stop(); },
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>,
              true,
            )}
          </div>
        )}
      </div>
      {canControl && steering && (
        <div style={{ padding: "0 12px 9px 49px" }}>
          <input
            type="text"
            value={draft}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") { event.preventDefault(); void sendSteer(); }
              if (event.key === "Escape") { event.preventDefault(); setSteering(false); }
            }}
            placeholder={t("agentSwitcher.steerPlaceholder")}
            aria-label={t("agentSwitcher.steerPlaceholder")}
            style={{
              width: "100%", height: 30, padding: "0 9px",
              border: "1px solid var(--border)", borderRadius: 6,
              background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none",
            }}
          />
          {error && <p style={{ margin: "6px 0 0", color: "#dc2626", fontSize: 11 }}>{error}</p>}
        </div>
      )}
    </div>
  );
}

export function AgentSessionPanel({ rootSession, subagents, selectedSessionId, runningSessionIds, onSelectSession }: Props) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const sortedSubagents = useMemo(() => [...subagents].sort((a, b) => {
    const aRunning = runningSessionIds.has(a.id);
    const bRunning = runningSessionIds.has(b.id);
    if (aRunning !== bRunning) return aRunning ? -1 : 1;
    return b.modified.localeCompare(a.modified);
  }), [runningSessionIds, subagents]);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleSubagents = normalizedQuery
    ? sortedSubagents.filter((session) => {
        const relation = session.relation?.kind === "subagent" ? session.relation : null;
        return [relation?.description, relation?.profile, session.name, session.firstMessage]
          .some((value) => value?.toLowerCase().includes(normalizedQuery));
      })
    : sortedSubagents;
  const runningCount = subagents.filter((session) => runningSessionIds.has(session.id)).length;
  const statuses = useLiveSubagentStatuses(
    subagents.filter((session) => isLiveSubagentStatus(
      session.relation?.kind === "subagent" ? session.relation.status : "completed",
    )).map((session) => session.id),
  );
  const statusOf = useCallback((session: SessionInfo): SubagentSessionStatus => {
    if (runningSessionIds.has(session.id)) return "running";
    if (session.relation?.kind !== "subagent") return "completed";
    // The catalogue says what the session file recorded; the shared poller says
    // what the server still has, which is what settles a run whose process died.
    return statuses.get(session.id) ?? session.relation.status;
  }, [runningSessionIds, statuses]);
  const [stoppingAll, setStoppingAll] = useState(false);
  const liveSubagents = visibleSubagents.filter((session) => isLive(statusOf(session)));
  const stopAll = async () => {
    setStoppingAll(true);
    // Fire every abort and settle once; one failure must not strand the rest.
    await Promise.allSettled(liveSubagents.map((session) => abortSubagentRun(session.id)));
    setStoppingAll(false);
  };

  return (
    <div
      role="group"
      aria-label={t("agentSwitcher.title")}
      style={{
        background: "var(--bg-panel)",
        borderLeft: "1px solid var(--border)",
        borderRight: "1px solid var(--border)",
        borderBottom: "1px solid var(--border)",
        borderRadius: "0 0 6px 6px",
        boxShadow: "0 10px 28px rgba(0,0,0,0.10)",
        overflow: "hidden",
      }}
    >
      <div>
        <div style={{ minHeight: 44, display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", borderBottom: "1px solid var(--border)" }}>
          <strong style={{ fontSize: 12, fontWeight: 600 }}>{t("agentSwitcher.title")}</strong>
          <span style={{ color: "var(--text-dim)", fontSize: 11 }}>
            {t("agentSwitcher.count", { count: subagents.length })}
          </span>
          {runningCount > 0 && (
            <span style={{ marginLeft: "auto", color: "var(--accent)", fontSize: 11 }}>
              {t("agentSwitcher.runningCount", { count: runningCount })}
            </span>
          )}
          {liveSubagents.length > 1 && (
            <button
              type="button"
              onClick={() => { void stopAll(); }}
              disabled={stoppingAll}
              style={{
                marginLeft: runningCount > 0 ? 0 : "auto",
                height: 24, padding: "0 9px",
                border: "1px solid var(--border)", borderRadius: 6,
                background: "var(--bg)", color: stoppingAll ? "var(--text-dim)" : "#dc2626",
                fontSize: 11, cursor: stoppingAll ? "default" : "pointer",
              }}
            >
              {t("agentSwitcher.stopAll", { count: liveSubagents.length })}
            </button>
          )}
        </div>
        {subagents.length > 8 && (
          <div style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("agentSwitcher.search")}
              aria-label={t("agentSwitcher.search")}
              style={{
                width: "100%", height: 32, padding: "0 10px",
                border: "1px solid var(--border)", borderRadius: 6,
                background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none",
              }}
            />
          </div>
        )}
        <div style={{ maxHeight: "min(58dvh, 480px)", overflowY: "auto" }}>
          <AgentRow
            session={rootSession}
            main
            selected={rootSession.id === selectedSessionId}
            running={runningSessionIds.has(rootSession.id)}
            status={statusOf(rootSession)}
            onSelect={() => onSelectSession(rootSession)}
          />
          {visibleSubagents.map((session) => (
            <AgentRow
              key={session.id}
              session={session}
              selected={session.id === selectedSessionId}
              running={runningSessionIds.has(session.id)}
              status={statusOf(session)}
              onSelect={() => onSelectSession(session)}
              onStop={() => abortSubagentRun(session.id)}
            />
          ))}
          {visibleSubagents.length === 0 && (
            <div style={{ padding: "22px 12px", color: "var(--text-dim)", fontSize: 12, textAlign: "center" }}>
              {t("agentSwitcher.noMatches")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

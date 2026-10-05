"use client";

import { useEffect, useState } from "react";
import type { AgentMessage } from "@/lib/types";

/**
 * A sub-agent's final reply, read from its own transcript through the same
 * context endpoint the chat uses.
 *
 * The dock needs this because a child's output exists in exactly one place that
 * is always present — the child's session file — no matter which runtime started
 * it and whether it ran in the foreground or the background. Its parent's
 * transcript only carries it for a foreground call, and only in aggregate for a
 * fan-out.
 */
export function useSubagentResult(sessionId: string | null | undefined): {
  text: string | null;
  loading: boolean;
} {
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!sessionId) {
      setText(null);
      return;
    }
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    const params = new URLSearchParams({ deferThinking: "1", deferMedia: "1", tail: "8" });
    fetch(`/api/sessions/${encodeURIComponent(sessionId)}/context?${params}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { context?: { messages?: AgentMessage[] } } | null) => {
        if (!active) return;
        setText(lastAssistantText(payload?.context?.messages));
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setText(null);
        setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [sessionId]);

  return { text, loading };
}

/** The last assistant turn that said something, searching backwards. */
function lastAssistantText(messages: AgentMessage[] | undefined): string | null {
  if (!messages) return null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    const text = assistantText(message.content);
    if (text.trim()) return text.trim();
  }
  return null;
}

// AgentMessage is a union and not every member carries content (a bash
// execution entry does not), so narrow before reading it.
function assistantText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is { type: "text"; text: string } => (
      typeof block === "object" && block !== null && (block as { type?: unknown }).type === "text"
    ))
    .map((block) => (block as { text?: unknown }).text)
    .filter((text): text is string => typeof text === "string")
    .join("\n");
}

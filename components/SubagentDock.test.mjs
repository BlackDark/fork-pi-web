import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { SubagentDock } = await jiti.import("./SubagentDock.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

const source = await readFile(new URL("./SubagentDock.tsx", import.meta.url), "utf8");

function child(id, status) {
  return {
    id,
    path: `${id}.jsonl`,
    cwd: "/tmp/project",
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-01T00:05:00.000Z",
    messageCount: 3,
    firstMessage: `task for ${id}`,
    relation: {
      kind: "subagent",
      parentSessionId: "parent",
      profile: "reviewer",
      description: `review ${id}`,
      status,
    },
  };
}

const rootSession = {
  id: "parent",
  path: "parent.jsonl",
  cwd: "/tmp/project",
  created: "2026-01-01T00:00:00.000Z",
  modified: "2026-01-01T00:05:00.000Z",
  messageCount: 9,
  firstMessage: "do the thing",
};

function render(props = {}) {
  return renderToStaticMarkup(React.createElement(
    I18nProvider,
    null,
    React.createElement(SubagentDock, {
      rootSession,
      subagents: [child("a", "completed"), child("b", "failed"), child("c", "running")],
      runningSessionIds: new Set(),
      onSelectSession() {},
      ...props,
    }),
  ));
}

test("it fills its panel instead of floating over the chat", () => {
  // A popup took the conversation away while a fan-out ran. The dock is a peer
  // of the file and terminal tabs, so it never covers the transcript.
  assert.match(source, /height: "100%"/);
  assert.doesNotMatch(source, /position: "fixed"/);
  assert.doesNotMatch(source, /zIndex/);
});

test("every child of the session is listed with its status", () => {
  const html = render();
  assert.match(html, /review a/);
  assert.match(html, /review b/);
  assert.match(html, /review c/);
  assert.match(html, />Completed</);
  assert.match(html, />Failed</);
  assert.match(html, />Running</);
});

test("a child the wrapper reports as running wins over a stale catalogue status", () => {
  const html = render({ subagents: [child("a", "completed")], runningSessionIds: new Set(["a"]) });
  assert.match(html, />Running/);
});

test("a family with no children says so rather than showing a blank panel", () => {
  assert.match(render({ subagents: [] }), /No sub-agents in this session/);
});

test("it offers status filters and prompts for a selection before showing detail", () => {
  const html = render();
  assert.match(html, /All \(3\)/);
  assert.match(html, />Completed/);
  // Stop, steer and the transcript hand-off live in the detail pane, which
  // needs a selected child; without one it says so rather than showing a
  // half-populated panel.
  assert.match(html, /Select a sub-agent to see what it is doing/);
  assert.doesNotMatch(html, /Open transcript/);
});

test("stop and steer are wired to the run's own session", () => {
  assert.match(source, /abortSubagentRun\(selected\.session\.id\)/);
  assert.match(source, /steerSubagentRun\(selected\.session\.id, message\)/);
  // Only a live run can be steered or stopped.
  assert.match(source, /selectedIsLive \? \(/);
});

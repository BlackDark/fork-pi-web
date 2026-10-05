import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AgentSessionPanel.tsx", import.meta.url), "utf8");

test("keeps the main session first and makes every agent session selectable", () => {
  const mainRow = source.indexOf("session={rootSession}");
  const subagentRows = source.indexOf("visibleSubagents.map");
  assert.ok(mainRow > 0);
  assert.ok(subagentRows > mainRow);
  assert.match(source, /onSelect=\{\(\) => onSelectSession\(rootSession\)\}/);
  assert.match(source, /onSelect=\{\(\) => onSelectSession\(session\)\}/);
  // A listbox may only contain options; the row hosts sibling control
  // buttons and a text input, so the panel is a plain labelled group.
  assert.match(source, /role="group"/);
  assert.doesNotMatch(source, /role="listbox"/);
  assert.doesNotMatch(source, /role="option"/);
  assert.match(source, /aria-current=\{selected \? "true" : undefined\}/);
});

test("sorts running subagents first and enables search only for larger families", () => {
  assert.match(source, /if \(aRunning !== bRunning\) return aRunning \? -1 : 1/);
  assert.match(source, /subagents\.length > 8/);
  assert.match(source, /relation\?\.description, relation\?\.profile, session\.name, session\.firstMessage/);
  assert.match(source, /maxHeight: "min\(58dvh, 480px\)"/);
});

test("renders as a compact left-positioned dropdown without a centered inner width", () => {
  assert.match(source, /borderLeft: "1px solid var\(--border\)"/);
  assert.match(source, /borderRadius: "0 0 6px 6px"/);
  assert.doesNotMatch(source, /maxWidth: 680/);
});

test("shows persisted completion states while a live server status takes precedence", () => {
  // The catalogue alone used to decide: a run whose process died kept saying
  // "running" forever. Status now comes from the caller, which merges the live
  // server state over the persisted one.
  assert.match(source, /status: SubagentSessionStatus;\n  onSelect/);
  assert.match(source, /status=\{statusOf\(session\)\}/);
  assert.match(source, /statuses\.get\(session\.id\) \?\? session\.relation\.status/);
  assert.match(source, /if \(runningSessionIds\.has\(session\.id\)\) return "running"/);
  assert.match(source, /t\(`agentSwitcher\.status\.\$\{status\}`\)/);
  assert.match(source, /status === "failed"/);
  assert.match(source, /status === "aborted" \|\| status === "interrupted"/);
});

test("offers stop and steer only for runs the server still has live", () => {
  assert.match(source, /const canControl = !main && isLive\(status\)/);
  assert.match(source, /status === "starting" \|\| status === "queued" \|\| status === "running"/);
  assert.match(source, /steerSubagentRun\(session\.id, message\)/);
  assert.match(source, /abortSubagentRun\(session\.id\)/);
  // Stop-all must not let one failure strand the remaining runs.
  assert.match(source, /Promise\.allSettled\(liveSubagents\.map/);
});

test("keeps controls outside the row's select button so the markup stays valid", () => {
  assert.match(source, /gridTemplateColumns: "minmax\(0, 1fr\) auto"/);
  assert.match(source, /event\.stopPropagation\(\); onClick\(\);/);
});

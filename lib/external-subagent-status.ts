import { readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { SubagentSessionStatus } from "./types";

// Reads the run state the external `nicobailon/pi-subagents` extension persists
// to disk. pi-web has its own sub-agent runtime, so it cannot see those runs
// live: they are started by a child process of that extension, not by an
// AgentSession of ours. The extension is explicit that an out-of-process host
// (which is what this is) reads the files, so this module is that reader: one
// status.json per run, written atomically by the extension (temp file plus
// rename), which is why a read never sees a torn file but may see stale-but-
// valid content. Retention renames run directories away at any moment and the
// async root may not exist at all, so every filesystem call tolerates ENOENT
// and nothing here throws.

// Extension's own mapping, the documented guidance for a host that reads these
// files (src/shared/types.ts). A Map, not an object literal: the state comes
// from a file, so an inherited key like "constructor" must not map to anything.
const STATE_STATUS = new Map<string, SubagentSessionStatus>([
  ["queued", "queued"],
  ["running", "running"],
  // The extension spells success "complete"; pi-web spells it "completed".
  ["complete", "completed"],
  ["failed", "failed"],
  // Terminal but not a success, and pi-web has no partial bucket.
  ["partial", "failed"],
  // Only the interrupt paths write this, never a user stop.
  ["paused", "interrupted"],
  // A deliberate stop, and a terminal refusal (which the runner itself never
  // writes, but child states do).
  ["stopped", "aborted"],
  ["rejected", "aborted"],
]);

// Only these two may still change. Notably NOT the file's mtime or lastUpdate:
// the runner rewrites status.json when the activity classification changes, so a
// long-running run can look old while it is alive. pidAlive carries that signal
// instead.
const LIVE_STATES = new Set(["queued", "running"]);

/** runId arrives from a URL query string: only a plain name may reach a path. */
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** A run id of this shape can only be one path segment below the async root. */
export function isSafeExternalRunId(runId: unknown): runId is string {
  return typeof runId === "string" && RUN_ID_PATTERN.test(runId);
}

/**
 * The extension's state for a run as pi-web's own status union, plus whether the
 * run may still change. A run directory exists before its first status write,
 * so a missing or unknown state reads as "starting" rather than a failure.
 */
export function mapExternalState(state: unknown): { status: SubagentSessionStatus; live: boolean } {
  const raw = typeof state === "string" ? state : undefined;
  const status = raw === undefined ? undefined : STATE_STATUS.get(raw);
  return {
    status: status ?? "starting",
    live: status !== undefined && LIVE_STATES.has(raw as string),
  };
}

/**
 * `<async root>`, the way the extension resolves it: PI_SUBAGENTS_TEMP_ROOT when
 * set, else a uid-scoped directory under the temp dir. Without a uid there is no
 * scope to guess, so there is no root.
 */
export function resolveExternalAsyncRoot(): string | null {
  const configured = process.env.PI_SUBAGENTS_TEMP_ROOT?.trim();
  if (configured) return path.join(path.resolve(configured), "async-subagent-runs");
  const getuid = process.getuid?.bind(process);
  if (typeof getuid !== "function") return null;
  return path.join(os.tmpdir(), `pi-subagents-uid-${getuid()}`, "async-subagent-runs");
}

export interface ExternalRunStatus {
  runId: string;
  status: SubagentSessionStatus;
  /** The extension's own state string, so a "partial" run can say so. */
  rawState?: string;
  live: boolean;
  pidAlive?: boolean;
  activity?: { tool?: string; path?: string; state?: string; turnCount?: number; toolCount?: number };
  error?: string;
  startedAt?: number;
  endedAt?: number;
  /**
   * Child session paths this run produced: status.sessionFile, every
   * steps[].sessionFile, and the path derived from sessionDir.
   */
  sessionFiles: string[];
}

/** Only the fields this reader needs; every one of them optional. */
interface ExternalStatusFile {
  state?: unknown;
  pid?: unknown;
  currentTool?: unknown;
  currentPath?: unknown;
  activityState?: unknown;
  turnCount?: unknown;
  toolCount?: unknown;
  startedAt?: unknown;
  endedAt?: unknown;
  error?: unknown;
  sessionFile?: unknown;
  sessionDir?: unknown;
  steps?: unknown;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * The single mode's child file sits next to the run directory the status names:
 * status.sessionDir is `<...>/async-<runId>` and the child is `run-0/session.jsonl`
 * beside it.
 */
function sessionFileFromSessionDir(sessionDir: string): string {
  return path.join(path.dirname(sessionDir), "run-0", "session.jsonl");
}

function collectSessionFiles(status: ExternalStatusFile): string[] {
  const files: string[] = [];
  const add = (value: unknown): void => {
    const file = nonEmptyString(value);
    if (file) files.push(file);
  };
  add(status.sessionFile);
  const sessionDir = nonEmptyString(status.sessionDir);
  if (sessionDir) add(sessionFileFromSessionDir(sessionDir));
  if (Array.isArray(status.steps)) {
    for (const step of status.steps) {
      if (step && typeof step === "object") add((step as { sessionFile?: unknown }).sessionFile);
    }
  }
  return [...new Set(files)];
}

/** `process.kill(pid, 0)` only checks for a process: EPERM means one is there. */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function toRunStatus(runId: string, raw: unknown): ExternalRunStatus | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const status = raw as ExternalStatusFile;
  const { status: mapped, live } = mapExternalState(status.state);
  const activity = {
    tool: nonEmptyString(status.currentTool),
    path: nonEmptyString(status.currentPath),
    state: nonEmptyString(status.activityState),
    turnCount: finiteNumber(status.turnCount),
    toolCount: finiteNumber(status.toolCount),
  };
  const hasActivity = Object.values(activity).some((value) => value !== undefined);
  const pid = finiteNumber(status.pid);
  const run: ExternalRunStatus = {
    runId,
    status: mapped,
    live,
    sessionFiles: collectSessionFiles(status),
  };
  const rawState = nonEmptyString(status.state);
  if (rawState !== undefined) run.rawState = rawState;
  if (pid !== undefined && Number.isInteger(pid) && pid > 0) run.pidAlive = isPidAlive(pid);
  if (hasActivity) run.activity = activity;
  const error = nonEmptyString(status.error);
  if (error !== undefined) run.error = error;
  const startedAt = finiteNumber(status.startedAt);
  if (startedAt !== undefined) run.startedAt = startedAt;
  const endedAt = finiteNumber(status.endedAt);
  if (endedAt !== undefined) run.endedAt = endedAt;
  return run;
}

interface CacheEntry {
  /** The file this entry was read from, so a different root never reuses it. */
  file: string;
  mtimeMs: number;
  size: number;
  value: ExternalRunStatus;
}

/**
 * Parsed runs held at once, one entry per run: the status file's path names its
 * run and the root it came from, so a run id is never reused for another root's
 * file. An entry is reused only while the file's mtime and size are unchanged,
 * which is all a reader can know from outside the runner.
 */
const CACHE_MAX_ENTRIES = 256;
const cache = new Map<string, CacheEntry>();

function readCached(file: string, mtimeMs: number, size: number): ExternalRunStatus | undefined {
  const entry = cache.get(file);
  if (!entry) return undefined;
  if (entry.mtimeMs === mtimeMs && entry.size === size) return entry.value;
  cache.delete(file);
  return undefined;
}

function writeCached(file: string, mtimeMs: number, size: number, value: ExternalRunStatus): void {
  cache.set(file, { file, mtimeMs, size, value });
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

async function readRunFromFile(runId: string, file: string): Promise<ExternalRunStatus | null> {
  let stats;
  try {
    stats = await stat(file);
  } catch {
    return null;
  }
  if (!stats.isFile()) return null;
  const cached = readCached(file, stats.mtimeMs, stats.size);
  if (cached) return cached;
  let parsed: ExternalRunStatus | null = null;
  try {
    const raw: unknown = JSON.parse(await readFile(file, "utf8"));
    parsed = toRunStatus(runId, raw);
  } catch {
    return null;
  }
  if (parsed) writeCached(file, stats.mtimeMs, stats.size, parsed);
  return parsed;
}

/**
 * One run by id. Null when the id is not usable, the run is unknown, its
 * status.json is malformed, or retention already reaped it. Never throws.
 */
export async function readExternalRun(runId: string): Promise<ExternalRunStatus | null> {
  if (!isSafeExternalRunId(runId)) return null;
  const root = resolveExternalAsyncRoot();
  if (!root) return null;
  try {
    return await readRunFromFile(runId, path.join(root, runId, "status.json"));
  } catch {
    return null;
  }
}

/** Many runs at once, skipping the ones that are not there. Never throws. */
export async function readExternalRuns(runIds: readonly string[]): Promise<Map<string, ExternalRunStatus>> {
  const unique = [...new Set(runIds)];
  const found = await Promise.all(unique.map((runId) => readExternalRun(runId)));
  const runs = new Map<string, ExternalRunStatus>();
  unique.forEach((runId, index) => {
    const run = found[index];
    if (run) runs.set(runId, run);
  });
  return runs;
}

/**
 * Every run the extension currently marks live, read from the marker files in
 * `<async root>/.active-runs` that its active-run index writes (empty files
 * named after the run). This lists the live runs only, never the run
 * directories, which retention can leave thousands of. Returns an empty map when
 * the root is absent. Never throws.
 */
export async function readActiveExternalRuns(): Promise<Map<string, ExternalRunStatus>> {
  const root = resolveExternalAsyncRoot();
  if (!root) return new Map();
  let entries: string[];
  try {
    entries = (await readdir(path.join(root, ".active-runs"), { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
  } catch {
    return new Map();
  }
  // A marker is released when the run stops, so a stale one can only be read as
  // a run that is no longer live: keep what the status file itself says.
  const runs = await readExternalRuns(entries.filter(isSafeExternalRunId));
  const live = new Map<string, ExternalRunStatus>();
  for (const [runId, run] of runs) {
    if (run.live) live.set(runId, run);
  }
  return live;
}
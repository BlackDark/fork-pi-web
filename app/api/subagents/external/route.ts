import { NextResponse } from "next/server";
import { realpathSync } from "fs";
import { isSafeExternalRunId, readActiveExternalRuns, readExternalRuns } from "@/lib/external-subagent-status";

export const dynamic = "force-dynamic";

/**
 * Run state persisted by another sub-agent extension (`nicobailon/pi-subagents`).
 *
 * pi-web's own runtime answers from memory via `/api/subagents/[id]`. Runs
 * started by another extension live in that extension's own process, and its
 * maintainers document reading these status files as the supported path for an
 * out-of-process host. There is no API to call: its RPC is in-process only.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const runIds = (url.searchParams.get("runIds") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  try {
    // Bounded: only the runs the caller names, or the runs the extension itself
    // currently marks live. The run directory is never enumerated wholesale —
    // it grows without bound and is reaped underneath us.
    const runs = url.searchParams.get("active") === "1" && runIds.length === 0
      ? await readActiveExternalRuns()
      : await readExternalRuns(runIds.filter(isSafeExternalRunId).slice(0, 50));

    // The caller names the session files it cares about, and the match happens
    // here: the paths the browser holds and the ones that extension recorded can
    // differ by symlink resolution (`/tmp` vs `/private/tmp`), and the browser
    // has no way to canonicalise its own copy.
    const wanted = (url.searchParams.get("paths") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 200)
      .map(canonicalize);
    const wantedSet = new Set(wanted);
    const payload: Record<string, unknown> = {};
    for (const [runId, run] of runs) {
      const matches = wanted.length === 0
        || run.sessionFiles.some((file) => wantedSet.has(canonicalize(file)));
      if (matches) payload[runId] = run;
    }

    return NextResponse.json({ runs: payload }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    // Best-effort status: the caller keeps whatever it already had.
    return NextResponse.json({ runs: {} }, { headers: { "Cache-Control": "no-store" } });
  }
}

/** Real path when the file exists, so two spellings of one path compare equal. */
function canonicalize(filePath: string): string {
  try {
    return realpathSync.native(filePath);
  } catch {
    return filePath;
  }
}

import { NextResponse } from "next/server";
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

    return NextResponse.json({ runs: Object.fromEntries(runs) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    // Best-effort status: the caller keeps whatever it already had.
    return NextResponse.json({ runs: {} }, { headers: { "Cache-Control": "no-store" } });
  }
}

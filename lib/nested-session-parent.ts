import { basename, dirname, join } from "node:path";

/**
 * Recover the parent of a nested child session from its location on disk.
 *
 * pi-web's own built-in runtime sets `parentSession` in the child header, but
 * other runtimes do not: `nicobailon/pi-subagents` creates children with
 * `SessionManager.create(cwd, sessionDir)` and no options, so its children
 * carry no header link at all. Without this, every such child is an ordinary
 * top-level session and floods the list.
 *
 * What every such runtime does share is the directory: children are written
 * into a folder named after the parent session, so the parent is recoverable
 * from the path alone. Both observed conventions are accepted — a folder named
 * after the parent file's stem, or after the parent's session id — and the
 * search walks up, because runtimes nest children to different depths.
 *
 * Returns a map of child path to parent path.
 */
export function resolveParentsByDirectory(paths: readonly string[]): Map<string, string> {
  // Every session file sitting directly in a directory, keyed by the two names
  // a child folder could be named after.
  const parentsByName = new Map<string, string>();
  const seen = new Set<string>();
  for (const filePath of paths) {
    if (seen.has(filePath)) continue;
    seen.add(filePath);
    const stem = basename(filePath, ".jsonl");
    for (const key of [stem, sessionIdFromStem(stem)]) {
      if (key && !parentsByName.has(key)) parentsByName.set(key, filePath);
    }
  }

  const links = new Map<string, string>();
  for (const filePath of seen) {
    let dir = dirname(filePath);
    // Walk up to the nearest ancestor named for a parent session. Depth is not
    // uniform in practice: pi-web writes children straight into the parent's
    // folder, while `nicobailon/pi-subagents` nests them per run as
    // <parent folder>/<child run id>/run-0/session.jsonl. Nearest match wins so
    // a grandchild joins its own parent rather than the outermost one.
    for (let depth = 0; depth < MAX_PARENT_WALK; depth += 1) {
      const ownerDir = dirname(dir);
      if (ownerDir === dir) break; // reached the filesystem root
      const candidate = parentsByName.get(basename(dir));
      // The parent must live in that folder's own parent directory, or a
      // same-named session elsewhere would capture this file.
      if (candidate && dirname(candidate) === ownerDir && candidate !== filePath) {
        links.set(filePath, candidate);
        break;
      }
      dir = ownerDir;
    }
  }
  return links;
}

/** Bound on the ancestor walk, so a deep or cyclic tree cannot run away. */
const MAX_PARENT_WALK = 8;

/** The directory pi-web writes a child into, for a parent session file. */
export function childSessionDirFor(parentSessionFile: string): string {
  return join(dirname(parentSessionFile), basename(parentSessionFile, ".jsonl"));
}

/**
 * The session id inside a `<timestamp>_<id>` file name, without reading the
 * file. pi names session files this way, so a folder named after the id can be
 * matched from the listing alone.
 */
function sessionIdFromStem(stem: string): string | undefined {
  const separator = stem.lastIndexOf("_");
  if (separator <= 0) return undefined;
  const id = stem.slice(separator + 1);
  return SESSION_ID_TOKEN.test(id) ? id : undefined;
}

const SESSION_ID_TOKEN = /^[A-Za-z0-9][A-Za-z0-9-]{7,}$/;

import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { projectIdentityKey } = await jiti.import("./project-identity.ts");
const {
  getProjectActivity,
  getRecentProjects,
  sessionsForProject,
} = await jiti.import("./project-groups.ts");

function session(id, projectRoot, modified) {
  return {
    id,
    path: `${id}.jsonl`,
    cwd: projectRoot,
    projectRoot,
    projectKey: projectIdentityKey(projectRoot, "win32"),
    created: modified,
    modified,
    messageCount: 1,
    firstMessage: id,
  };
}

test("Windows path variants form one recent project using the newest display path", () => {
  const older = session("older", "C:\\Users\\Alex\\Project\\Study\\ELM", "2026-08-12T00:00:00.000Z");
  const newer = session("newer", "c:/users/ALEX/project/study/elm", "2026-08-13T00:00:00.000Z");

  assert.deepEqual(getRecentProjects([older, newer]), [{
    key: older.projectKey,
    root: newer.projectRoot,
  }]);
});

test("project filtering includes every session with the stable identity", () => {
  const first = session("first", "C:\\Users\\Alex\\Project", "2026-08-12T00:00:00.000Z");
  const second = session("second", "c:/users/alex/project/", "2026-08-13T00:00:00.000Z");
  const other = session("other", "D:\\Elsewhere", "2026-08-13T01:00:00.000Z");

  assert.deepEqual(
    sessionsForProject([first, second, other], first.projectKey).map((item) => item.id),
    ["first", "second"],
  );
});

test("running and unread counts aggregate under the stable project identity", () => {
  const first = session("first", "C:\\Users\\Alex\\Project", "2026-08-12T00:00:00.000Z");
  const second = session("second", "c:/users/alex/project/", "2026-08-13T00:00:00.000Z");

  const activity = getProjectActivity(
    [first, second],
    new Set(["first", "second"]),
    new Set(["second"]),
  );

  assert.deepEqual(activity.get(first.projectKey), { running: 2, unread: 1 });
  assert.equal(activity.size, 1);
});

function subagent(id, projectRoot, modified) {
  return {
    ...session(id, projectRoot, modified),
    relation: { kind: "subagent", parentSessionId: "parent", profile: "scout", description: "recon", status: "completed" },
  };
}

test("a sub-agent never contributes a project of its own", () => {
  const projects = getRecentProjects([
    session("parent", "/tmp/alpha", "2026-08-01T00:00:00.000Z"),
    // Newest overall, but it is a child: it must not float /tmp/beta to the top.
    subagent("child", "/tmp/beta", "2026-08-20T00:00:00.000Z"),
  ]);
  assert.deepEqual(projects.map((project) => project.root), ["/tmp/alpha"]);
});

test("a project whose only activity was sub-agents is not offered", () => {
  assert.deepEqual(getRecentProjects([subagent("child", "/tmp/beta", "2026-08-20T00:00:00.000Z")]), []);
});

test("project badges ignore sub-agents so a running child is not double counted", () => {
  const parent = session("parent", "/tmp/alpha", "2026-08-01T00:00:00.000Z");
  const child = subagent("child", "/tmp/alpha", "2026-08-02T00:00:00.000Z");
  const counts = getProjectActivity([parent, child], new Set(["parent", "child"]), new Set(["child"]));
  assert.deepEqual(counts.get(parent.projectKey), { running: 1, unread: 0 });
});

test("sessionsForProject still returns sub-agents so families can group them", () => {
  const parent = session("parent", "/tmp/alpha", "2026-08-01T00:00:00.000Z");
  const child = subagent("child", "/tmp/alpha", "2026-08-02T00:00:00.000Z");
  const found = sessionsForProject([parent, child], parent.projectKey);
  assert.deepEqual(found.map((entry) => entry.id), ["parent", "child"]);
});

// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GoalCoordinator } from "./goalCoordinator";
import { GoalMcpIngress } from "./goalMcpIngress";

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const done of cleanup.splice(0)) done();
});
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "goal-mcp-"));
  const goals = new GoalCoordinator({
    path: join(dir, "goals.json"),
    emit: () => {},
    snapshot: () => undefined,
    continueGoal: async () => {},
  });
  const ingress = new GoalMcpIngress(goals, (id) =>
    id === "session-a" ? "a" : id === "session-b" ? "b" : undefined,
  );
  const server = await ingress.register("a");
  cleanup.push(() => {
    goals.dispose();
    ingress.dispose();
    rmSync(dir, { recursive: true, force: true });
  });
  if (server.transport.type !== "http") throw new Error("Expected HTTP");
  const endpoint = server.transport;
  const call = async (method: string, params?: unknown, headers = endpoint.headers) => {
    const res = await fetch(endpoint.url, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    return { status: res.status, body: (await res.json()) as any };
  };
  return { goals, ingress, call };
}
describe("goal MCP caller identity", () => {
  it("exposes real tool schemas and records completion through HTTP", async () => {
    const f = await fixture();
    const list = await f.call("tools/list");
    expect(list.body.result.tools.map((t: { name: string }) => t.name)).toEqual([
      "create_goal",
      "get_goal",
      "update_goal",
    ]);
    const created = await f.call("tools/call", {
      name: "create_goal",
      arguments: { objective: "目标 A" },
    });
    expect(created.body.result.isError).toBeUndefined();
    const completed = await f.call("tools/call", {
      name: "update_goal",
      arguments: { status: "complete", reason: "当前产物与测试已验证" },
    });
    expect(completed.body.result.isError).toBeUndefined();
    expect(f.goals.get("a")?.status).toBe("complete");
  });
  it("rejects missing authorization and cannot select another thread through tool arguments", async () => {
    const f = await fixture();
    expect((await f.call("tools/list", undefined, {})).status).toBe(401);
    await f.call("tools/call", {
      name: "create_goal",
      arguments: { objective: "目标 A", threadId: "b" },
    });
    expect(f.goals.get("a")?.objective).toBe("目标 A");
    expect(f.goals.get("b")).toBeNull();
  });
  it("routes shared provider connections only with the trusted native session id", async () => {
    const f = await fixture();
    const a = await f.ingress.register("a", true);
    const b = await f.ingress.register("b", true);
    if (a.transport.type !== "http" || b.transport.type !== "http")
      throw new Error("Expected HTTP");
    expect(a.transport.headers).toEqual(b.transport.headers);
    const denied = await f.call(
      "tools/call",
      { name: "create_goal", arguments: { objective: "wrong" } },
      a.transport.headers,
    );
    expect(denied.body.result.isError).toBe(true);
    await f.call(
      "tools/call",
      {
        name: "create_goal",
        arguments: { objective: "目标 B", __craftstation_provider_session_id: "session-b" },
      },
      a.transport.headers,
    );
    expect(f.goals.get("b")?.objective).toBe("目标 B");
    expect(f.goals.get("a")).toBeNull();
    f.ingress.unregister("b");
    const revoked = await f.call(
      "tools/call",
      { name: "get_goal", arguments: { __craftstation_provider_session_id: "session-b" } },
      a.transport.headers,
    );
    expect(revoked.body.result.isError).toBe(true);
  });
});

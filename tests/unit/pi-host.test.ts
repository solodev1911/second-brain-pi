import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { PiCommandContext, PiHost } from "../../src/pi-host.js";

describe("Pi compatibility adapter", () => {
  it("owns tool discovery, activation, flags, and audit calls", () => {
    const registerFlag = vi.fn();
    const setActiveTools = vi.fn();
    const appendEntry = vi.fn();
    const api = {
      registerFlag,
      getFlag: (name: string) => name === "second-brain-project-root" ? " /project " : undefined,
      getAllTools: () => [{ name: "read" }, { name: "query_graph" }],
      getActiveTools: () => ["read"],
      setActiveTools,
      appendEntry,
    } as unknown as ExtensionAPI;
    const host = new PiHost(api);

    host.registerStringFlag("second-brain-project-root", "Project root");
    host.setActiveToolNames(["read", "query_graph"]);
    host.appendAuditEntry("receipt", { ok: true });

    expect(host.stringFlag("second-brain-project-root")).toBe("/project");
    expect(host.allToolNames()).toEqual(["read", "query_graph"]);
    expect(host.activeToolNames()).toEqual(["read"]);
    expect(registerFlag).toHaveBeenCalledWith("second-brain-project-root", { type: "string", description: "Project root" });
    expect(setActiveTools).toHaveBeenCalledWith(["read", "query_graph"]);
    expect(appendEntry).toHaveBeenCalledWith("receipt", { ok: true });
  });

  it("adapts command state and active-model completion", async () => {
    const complete = vi.fn(async () => ({
      stopReason: "stop",
      content: [{ type: "text", text: "first" }, { type: "thinking", thinking: "private" }, { type: "text", text: "second" }],
    }));
    const model = { provider: "fixture", id: "fixture" };
    const context = new PiCommandContext({
      mode: "rpc",
      cwd: "/project",
      isIdle: () => true,
      hasPendingMessages: () => false,
      isProjectTrusted: () => true,
      sessionManager: { getBranch: () => [], getSessionId: () => "session" },
      ui: { notify: vi.fn(), setStatus: vi.fn() },
      model,
      modelRegistry: { hasConfiguredAuth: () => true, complete },
    } as unknown as ExtensionCommandContext);

    expect(context.supportsRemember()).toBe(true);
    expect(context.isCaptureReady()).toBe(true);
    expect(context.cwd()).toBe("/project");
    expect(context.sessionId()).toBe("session");
    await expect(context.completionAdapter()("system", "user", new AbortController().signal)).resolves.toBe("first\nsecond");
    expect(complete).toHaveBeenCalledOnce();
  });
});

import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { selectCaptureSnapshot } from "../../src/turn-selection.js";

const user = (id: string, text: string) => ({ id, parentId: null, timestamp: "", type: "message", message: { role: "user", content: text, timestamp: 1 } }) as unknown as SessionEntry;
const assistant = (id: string, text: string, stopReason = "stop", content?: unknown[]) => ({ id, parentId: null, timestamp: "", type: "message", message: { role: "assistant", content: content ?? [{ type: "text", text }], stopReason, timestamp: 2, provider: "test", model: "test", api: "test", usage: {} } }) as unknown as SessionEntry;
const toolResult = (id: string, toolCallId: string, details: unknown) => ({ id, parentId: null, timestamp: "", type: "message", message: { role: "toolResult", toolCallId, toolName: "query_graph", content: [{ type: "text", text: "NODE total [src=billing.py loc=L3 community=Core]" }], isError: false, timestamp: 2, details } }) as unknown as SessionEntry;

describe("latest eligible active-branch turn", () => {
  it("selects the latest user boundary and matched second-brain evidence", () => {
    const entries = [
      user("u", "Where?"),
      assistant("call", "", "toolUse", [{ type: "toolCall", id: "tc", name: "query_graph", arguments: {} }]),
      toolResult("tr", "tc", { kind: "second-brain.graphify", schemaVersion: 1, projectRoot: "/p", backendTool: "query_graph", toolCallId: "tc", emittedNodeIds: ["total"], evidenceEligible: true, truncated: false, success: true }),
      assistant("a", "In billing."),
    ];
    const selected = selectCaptureSnapshot({ entries, sessionId: "s", sessionGeneration: 2, projectRoot: "/p" });
    expect(selected.answerEntryId).toBe("a");
    expect(selected.allowedNodeIds).toEqual(["total"]);
  });

  it("does not skip a later failed answer to save an earlier success", () => {
    const entries = [user("u1", "A"), assistant("a1", "A ok"), user("u2", "B"), assistant("a2", "B failed", "error")];
    expect(() => selectCaptureSnapshot({ entries, sessionId: "s", sessionGeneration: 1, projectRoot: "/p" })).toThrow(/not a completed answer/i);
  });

  it("rejects pending tool calls and forged provenance", () => {
    expect(() => selectCaptureSnapshot({ entries: [user("u", "A"), assistant("a", "", "stop", [{ type: "toolCall", id: "x", name: "read", arguments: {} }])], sessionId: "s", sessionGeneration: 1, projectRoot: "/p" })).toThrow(/tool request/i);
    const forged = selectCaptureSnapshot({ entries: [user("u", "A"), toolResult("tr", "absent", { kind: "second-brain.graphify", schemaVersion: 1, projectRoot: "/p", backendTool: "query_graph", toolCallId: "absent", emittedNodeIds: ["secret"], evidenceEligible: true, success: true }), assistant("a", "Done")], sessionId: "s", sessionGeneration: 1, projectRoot: "/p" });
    expect(forged.allowedNodeIds).toEqual([]);
  });
});

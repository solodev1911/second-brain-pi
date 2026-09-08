import { describe, expect, it } from "vitest";
import { deterministicFallback, distill, parseDistilledMemory, redactObviousCredentials } from "../../src/distillation.js";
import type { CaptureSnapshot } from "../../src/types.js";

const snapshot: CaptureSnapshot = {
  sessionId: "session", sessionGeneration: 1, projectRoot: "/project",
  userEntryId: "u", answerEntryId: "a", sourceAnswerSha256: "hash",
  question: "Where is total calculated?", answer: "The total is calculated by calculate_total in src/billing.py.",
  allowedNodeIds: ["calculate_total"], evidenceText: "NODE calculate_total", supplementaryText: "", capturedAt: "2026-09-07T00:00:00.000Z",
};

describe("distillation", () => {
  it("parses exact marker framing and complete legacy JSON", () => {
    expect(parseDistilledMemory("<<<QUESTION>>>\nWhere?\n<<<SUMMARY>>>\nIn billing.\n<<<ANSWER>>>\nUse calculate_total.\n<<<SOURCE_NODES>>>\ncalculate_total\n<<<END>>>").sourceNodes).toEqual(["calculate_total"]);
    expect(parseDistilledMemory('{"question":"Where?","answer":"First line.\\nMore","source_nodes":[]}').summary).toBe("First line.");
    expect(() => parseDistilledMemory("```json\n{}\n```")).toThrow();
  });

  it("repairs once and otherwise falls back deterministically without citations", async () => {
    let calls = 0;
    const repaired = await distill(snapshot, async () => {
      calls += 1;
      if (calls === 1) return "bad";
      return "<<<QUESTION>>>\nWhere?\n<<<SUMMARY>>>\nIn billing.\n<<<ANSWER>>>\nUse calculate_total.\n<<<SOURCE_NODES>>>\ncalculate_total\n<<<END>>>";
    });
    expect(repaired.usedFallback).toBe(false);
    expect(calls).toBe(2);
    const fallback = await distill(snapshot, async () => { throw new Error("provider unavailable"); });
    expect(fallback.usedFallback).toBe(true);
    expect(fallback.memory).toEqual(deterministicFallback(snapshot));
    expect(fallback.memory.sourceNodes).toEqual([]);
  });

  it("redacts obvious secrets", () => {
    const result = redactObviousCredentials("token=abcdefghijk and ghp_abcdefghijklmnop");
    expect(result.redacted).toBe(true);
    expect(result.value).not.toContain("abcdefgh");
  });
});

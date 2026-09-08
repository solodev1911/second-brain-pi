import { mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseSerializedMemory, serializeMemory } from "../../src/memory-format.js";
import { publishMemory } from "../../src/memory-store.js";
import type { MemoryRecord } from "../../src/types.js";

const record: MemoryRecord = {
  question: 'Where is "total"?', summary: "Billing total location", answer: "Use `calculate_total`.\n\nKeep exact cents.",
  sourceNodes: ["calculate_total"], date: "2026-09-07T00:00:00.000Z", contributor: "pi",
};

describe("durable memory format and publication", () => {
  it("round-trips escaped metadata", () => {
    expect(parseSerializedMemory(serializeMemory(record))).toMatchObject({ question: record.question, summary: record.summary, answer: record.answer, sourceNodes: record.sourceNodes });
  });

  it("atomically publishes and deduplicates parallel exact payloads", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "second-brain-memory-"));
    const [first, second] = await Promise.all([
      publishMemory(root, record, async () => undefined),
      publishMemory(root, record, async () => undefined),
    ]);
    expect(first.relativePath).toBe(second.relativePath);
    expect([first.deduplicated, second.deduplicated].sort()).toEqual([false, true]);
    const files = (await readdir(path.join(root, "graphify-out", "memory"))).filter((name) => name.endsWith(".md"));
    expect(files).toHaveLength(1);
    expect(await readFile(first.absolutePath, "utf8")).toBe(serializeMemory(record));
  });

  it("revalidates before creating any final markdown", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "second-brain-cancel-"));
    await expect(publishMemory(root, record, async () => { throw new Error("changed"); })).rejects.toThrow("changed");
    const names = await readdir(path.join(root, "graphify-out", "memory"));
    expect(names.filter((name) => name.endsWith(".md"))).toEqual([]);
  });
});

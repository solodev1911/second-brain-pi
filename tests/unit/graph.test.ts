import { describe, expect, it } from "vitest";
import { canonicalizeProposedSourceIds, emittedNodeIds, truncateUtf8Records } from "../../src/graph.js";
import type { GraphDocument } from "../../src/types.js";

const graph: GraphDocument = {
  nodes: [
    { id: "total", label: "calculate_total", source_file: "src/billing.py", source_location: "L3" },
    { id: "duplicate-a", label: "duplicate", source_file: "a.py" },
    { id: "duplicate-b", label: "duplicate", source_file: "b.py" },
    { id: "memory", label: "old", source_file: "graphify-out/memory/old.md", metadata: { kind: "memory" } },
  ], links: [],
};

describe("graph evidence", () => {
  it("maps retained query records to unique IDs only", () => {
    expect(emittedNodeIds("query_graph", "NODE calculate_total [src=src/billing.py loc=L3 community=Core]", graph)).toEqual(["total"]);
    expect(emittedNodeIds("query_graph", "NODE duplicate [src= loc= community=Core]", graph)).toEqual([]);
  });

  it("intersects canonical proposals with the turn allowlist and excludes memories", () => {
    expect(canonicalizeProposedSourceIds(["calculate_total", "old", "duplicate"], new Set(["total", "memory", "duplicate-a"]), graph)).toEqual(["total"]);
  });

  it("truncates only at complete UTF-8 lines", () => {
    const result = truncateUtf8Records(`αβγ\n${"second".repeat(40)}\nthird`, 100);
    expect(result.truncated).toBe(true);
    expect(result.text).toContain("truncated");
    expect(result.text).not.toContain("�");
  });
});

import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readGraph, verifyIndexedMemory } from "../../src/graph.js";
import { GraphifyService } from "../../src/graphify-service.js";
import { publishMemory } from "../../src/memory-store.js";
import type { MemoryRecord } from "../../src/types.js";

const packageRoot = path.resolve(import.meta.dirname, "../..");
const engineRoot = process.env.SECOND_BRAIN_TEST_GRAPHIFY_ROOT ?? path.join(packageRoot, "graphify");
const python = process.env.SECOND_BRAIN_TEST_GRAPHIFY_PYTHON ?? path.join(engineRoot, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const services: GraphifyService[] = [];

async function fixture(name: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), `second-brain-${name}-`));
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "billing.py"), [
    "def calculate_total(items):",
    "    return sum(item['price_cents'] for item in items)",
    "",
    "def create_invoice(items):",
    "    return {'total_cents': calculate_total(items)}",
    "",
  ].join("\n"));
  return import("node:fs/promises").then((fs) => fs.realpath(root));
}

function service(root: string): GraphifyService {
  const value = new GraphifyService(root, { command: python, args: ["-m", "graphify.serve"], cwd: engineRoot, source: "flags" });
  services.push(value);
  return value;
}

function text(result: Awaited<ReturnType<GraphifyService["nativeTool"]>>): string {
  return result.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
}

afterAll(async () => Promise.all(services.map((entry) => entry.close())));

describe("real Graphify stdio contract", () => {
  it("discovers eight tools, refreshes, indexes a memory, and isolates projects", async () => {
    const root = await fixture("contract");
    const graphify = service(root);
    const capabilities = await graphify.initialize();
    expect([...capabilities]).toEqual(expect.arrayContaining([
      "query_graph", "refresh_graph", "get_node", "get_neighbors", "get_community", "god_nodes", "graph_stats", "shortest_path",
    ]));
    const initial = await graphify.refresh();
    expect(initial.projectPath).toBe(await import("node:fs/promises").then((fs) => fs.realpath(root)));
    expect(initial.nodes).toBeGreaterThan(0);
    const graph = await readGraph(root);
    const source = graph.document.nodes.find((node) => node.label === "calculate_total()");
    expect(source?.id).toBeTruthy();

    const record: MemoryRecord = {
      question: "Where is the invoice total calculated?",
      summary: "Invoice totals are calculated by calculate_total in src/billing.py.",
      answer: "Use `calculate_total`; it sums each item's `price_cents`, and `create_invoice` stores the result as `total_cents`.",
      sourceNodes: [source!.id], date: "2026-09-07T00:00:00.000Z", contributor: "pi",
    };
    const publication = await publishMemory(root, record, async () => undefined);
    const generation = graphify.markPublished();
    const refreshed = await graphify.refreshAfter(generation);
    expect(refreshed.memoryNodes).toBe(1);
    expect(refreshed.memoryEdges).toBe(1);
    expect(await verifyIndexedMemory(root, publication.absolutePath, record)).toEqual({ status: "indexed", memoryLinks: 1 });

    const query = await graphify.nativeTool("contract-call", "query_graph", { question: "invoice total calculate_total", mode: "bfs", depth: 3, token_budget: 2_000 });
    expect(text(query)).toMatch(/Invoice totals|calculate_total/);
    expect(query.details?.projectRoot).toBe(root);

    const sourceNode = graph.document.nodes.find((node) => node.id === source!.id)!;
    const edge = (graph.document.links ?? graph.document.edges ?? []).find((link) => {
      const from = typeof link.source === "object" ? link.source.id : link.source;
      const to = typeof link.target === "object" ? link.target.id : link.target;
      return graph.document.nodes.some((node) => node.id === from) && graph.document.nodes.some((node) => node.id === to);
    });
    expect(edge).toBeTruthy();
    const edgeSourceId = String(typeof edge!.source === "object" ? edge!.source.id : edge!.source);
    const edgeTargetId = String(typeof edge!.target === "object" ? edge!.target.id : edge!.target);
    const edgeSource = graph.document.nodes.find((node) => node.id === edgeSourceId)!;
    const edgeTarget = graph.document.nodes.find((node) => node.id === edgeTargetId)!;
    const community = Number(sourceNode.community ?? edgeSource.community);
    expect(Number.isInteger(community) && community >= 0).toBe(true);

    const focused = await Promise.all([
      graphify.nativeTool("node-call", "get_node", { label: source!.id }),
      graphify.nativeTool("neighbors-call", "get_neighbors", { label: edgeSource.id }),
      graphify.nativeTool("community-call", "get_community", { community_id: community }),
      graphify.nativeTool("hubs-call", "god_nodes", { top_n: 5 }),
      graphify.nativeTool("stats-call", "graph_stats", {}),
      graphify.nativeTool("path-call", "shortest_path", { source: edgeSource.label, target: edgeTarget.label, max_hops: 8 }),
    ]);
    for (const result of focused) {
      expect(text(result)).toBeTruthy();
      expect(result.details?.success).toBe(true);
    }
    expect(text(focused[0])).toMatch(/calculate_total|billing\.py/);
    expect(text(focused[4])).toMatch(/Nodes:/);
    expect(text(focused[5])).toMatch(/path|→|->|hop/i);

    await graphify.close();
    const restarted = await graphify.initialize();
    expect([...restarted]).toEqual(expect.arrayContaining(["query_graph", "refresh_graph"]));
    expect(text(await graphify.nativeTool("restart-stats", "graph_stats", {}))).toMatch(/Nodes:/);

    const otherRoot = await fixture("isolated");
    const other = service(otherRoot);
    await other.refresh();
    const otherQuery = await other.nativeTool("other-call", "query_graph", { question: "invoice total", mode: "bfs", depth: 2, token_budget: 1_000 });
    expect(otherQuery.content[0]?.type === "text" ? otherQuery.content[0].text : "").not.toContain(record.summary);
  }, 240_000);
});

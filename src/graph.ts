import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { MODEL_VISIBLE_RESULT_BYTES } from "./constants.js";
import { containsPath, projectRelative, samePath } from "./project-root.js";
import type { GraphDocument, GraphLink, GraphNode, MemoryRecord, MemoryVerification } from "./types.js";
import { SecondBrainError } from "./types.js";

export async function fileSha256(file: string): Promise<string> {
  const data = await readFile(file);
  return createHash("sha256").update(data).digest("hex");
}

export async function readGraph(projectRoot: string): Promise<{ document: GraphDocument; sha256: string; path: string }> {
  const canonicalRoot = await realpath(projectRoot);
  const graphPath = path.join(canonicalRoot, "graphify-out", "graph.json");
  const canonical = await realpath(graphPath);
  if (!containsPath(canonicalRoot, canonical)) throw new SecondBrainError("GRAPH_ESCAPE", "graph.json resolves outside the project root.");
  const info = await stat(canonical);
  if (!info.isFile() || info.size > 128 * 1024 * 1024) throw new SecondBrainError("GRAPH_INVALID", "graph.json is missing, not a file, or too large.");
  const data = await readFile(canonical);
  const sha256 = createHash("sha256").update(data).digest("hex");
  const parsed = JSON.parse(data.toString("utf8")) as GraphDocument;
  if (!Array.isArray(parsed.nodes) || (!Array.isArray(parsed.links) && !Array.isArray(parsed.edges))) {
    throw new SecondBrainError("GRAPH_INVALID", "graph.json does not contain node-link data.");
  }
  return { document: parsed, sha256, path: canonical };
}

function normalizedSource(value: unknown): string {
  return typeof value === "string" ? value.replaceAll("\\", "/").replace(/^\.\//, "") : "";
}

function nodeKind(node: GraphNode): unknown {
  return node.metadata?.kind ?? node.kind;
}

export function isMemoryNode(node: GraphNode): boolean {
  return nodeKind(node) === "memory" || normalizedSource(node.source_file).startsWith("graphify-out/memory/");
}

function resolveUnique(nodes: GraphNode[], predicate: (node: GraphNode) => boolean): string | undefined {
  const matches = nodes.filter(predicate);
  return matches.length === 1 ? matches[0]?.id : undefined;
}

export function canonicalizeProposedSourceIds(
  proposed: string[],
  allowed: ReadonlySet<string>,
  graph: GraphDocument,
): string[] {
  const resolved: string[] = [];
  for (const raw of proposed) {
    const candidate = raw.trim();
    if (!candidate) continue;
    let id = graph.nodes.find((node) => node.id === candidate)?.id;
    id ??= resolveUnique(graph.nodes, (node) => node.label === candidate);
    id ??= resolveUnique(graph.nodes, (node) => normalizedSource(node.source_file) === normalizedSource(candidate));
    const symbol = candidate.replace(/^\./, "").replace(/\(\)$/, "");
    id ??= resolveUnique(graph.nodes, (node) => String(node.label ?? "").replace(/^\./, "").replace(/\(\)$/, "") === symbol);
    if (!id || !allowed.has(id)) continue;
    const node = graph.nodes.find((entry) => entry.id === id);
    if (!node || isMemoryNode(node) || resolved.includes(id)) continue;
    resolved.push(id);
    if (resolved.length === 10) break;
  }
  return resolved;
}

function parseLocation(value: string): string {
  return value.trim().replace(/^L/i, "");
}

export function emittedNodeIds(tool: string, text: string, graph: GraphDocument): string[] {
  if (tool === "get_node") {
    const id = /^\s*ID:\s*(.+?)\s*$/m.exec(text)?.[1];
    return id && graph.nodes.some((node) => node.id === id) ? [id] : [];
  }
  if (tool !== "query_graph") return [];
  const ids: string[] = [];
  const record = /^NODE\s+(.+?)\s+\[src=(.*?)\s+loc=(.*?)\s+community=.*\]$/gm;
  for (const match of text.matchAll(record)) {
    const label = match[1]?.trim();
    const source = normalizedSource(match[2]);
    const location = parseLocation(match[3] ?? "");
    const id = resolveUnique(graph.nodes, (node) => {
      if (String(node.label ?? node.id) !== label) return false;
      if (source && normalizedSource(node.source_file) !== source) return false;
      if (location && parseLocation(String(node.source_location ?? "")) !== location) return false;
      return true;
    });
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function truncateUtf8Records(text: string, maximum = MODEL_VISIBLE_RESULT_BYTES): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text, "utf8") <= maximum) return { text, truncated: false };
  const lines = text.split("\n");
  const kept: string[] = [];
  let size = 0;
  for (const line of lines) {
    const addition = Buffer.byteLength(`${line}\n`, "utf8");
    if (size + addition > maximum - 80) break;
    kept.push(line);
    size += addition;
  }
  kept.push("[Second Brain result truncated at a complete line]");
  return { text: kept.join("\n"), truncated: true };
}

function endpointId(value: GraphLink["source"]): string {
  return typeof value === "string" ? value : String(value.id ?? "");
}

export async function verifyIndexedMemory(
  projectRoot: string,
  savedAbsolutePath: string,
  record: MemoryRecord,
): Promise<MemoryVerification> {
  const { document } = await readGraph(projectRoot);
  const relative = projectRelative(projectRoot, savedAbsolutePath).replaceAll("\\", "/");
  const matches = document.nodes.filter((node) => {
    const source = normalizedSource(node.source_file ?? node.metadata?.source_file);
    return isMemoryNode(node) && source === relative;
  });
  if (matches.length !== 1) {
    return { status: "unverified", warning: `Expected one indexed memory node for ${relative}; found ${matches.length}.` };
  }
  const node = matches[0]!;
  const question = String(node.question ?? node.metadata?.question ?? "");
  const summary = String(node.summary ?? node.metadata?.summary ?? node.label ?? "");
  if (question !== record.question || !summary.includes(record.summary)) {
    return { status: "unverified", warning: "Indexed memory metadata does not match the saved record." };
  }
  const links = document.links ?? document.edges ?? [];
  const memoryLinks = links.filter((link) => link.relation === "memory" && (
    endpointId(link.source) === node.id || endpointId(link.target) === node.id
  )).length;
  return { status: "indexed", memoryLinks };
}

export async function assertReturnedRefreshPaths(
  projectRoot: string,
  projectPath: string,
  graphPath: string,
  htmlPath: string,
): Promise<void> {
  const canonicalRoot = await realpath(projectRoot);
  const returnedRoot = await realpath(projectPath);
  if (!samePath(canonicalRoot, returnedRoot)) throw new SecondBrainError("REFRESH_PATH_MISMATCH", "Graphify refreshed a different project.");
  const expectedGraph = await realpath(path.join(canonicalRoot, "graphify-out", "graph.json"));
  const expectedHtml = await realpath(path.join(canonicalRoot, "graphify-out", "graph.html"));
  const returnedGraph = await realpath(graphPath);
  const returnedHtml = await realpath(htmlPath);
  if (!samePath(expectedGraph, returnedGraph) || !samePath(expectedHtml, returnedHtml)
    || !containsPath(canonicalRoot, returnedGraph) || !containsPath(canonicalRoot, returnedHtml)) {
    throw new SecondBrainError("REFRESH_PATH_MISMATCH", "Graphify returned output paths outside the selected project.");
  }
}

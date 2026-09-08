import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { REFRESH_TIMEOUT_MS, READ_TIMEOUT_MS } from "./constants.js";
import { assertReturnedRefreshPaths, emittedNodeIds, readGraph, truncateUtf8Records } from "./graph.js";
import { GraphifyClient } from "./graphify-client.js";
import type { EngineConfig, GraphifyEvidenceDetails, RefreshResult } from "./types.js";
import { SecondBrainError } from "./types.js";

const REQUIRED = new Set(["query_graph", "refresh_graph"]);
export const OPTIONAL_GRAPH_TOOLS = ["get_node", "get_neighbors", "get_community", "god_nodes", "graph_stats", "shortest_path"] as const;
export const ALL_GRAPH_TOOLS = ["query_graph", "refresh_graph", ...OPTIONAL_GRAPH_TOOLS] as const;

export class SerializedQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

export class GraphifyService {
  private client: GraphifyClient;
  private readonly queue = new SerializedQueue();
  private capabilities = new Set<string>();
  private connection?: Promise<Set<string>>;
  private refreshPromise?: { startedAtGeneration: number; promise: Promise<RefreshResult> };
  private publicationGeneration = 0;

  constructor(
    public readonly projectRoot: string,
    public readonly engine: EngineConfig,
  ) {
    this.client = new GraphifyClient(engine);
  }

  async initialize(signal?: AbortSignal): Promise<Set<string>> {
    this.connection ??= this.client.connect(signal).then((capabilities) => {
      this.capabilities = capabilities;
      const missing = [...REQUIRED].filter((name) => !capabilities.has(name));
      if (missing.length) throw new SecondBrainError("CAPABILITY_MISMATCH", `Graphify is missing required MCP tools: ${missing.join(", ")}.`);
      return capabilities;
    }).catch((error) => {
      this.connection = undefined;
      throw error;
    });
    return this.connection;
  }

  supportedTools(): string[] {
    return ALL_GRAPH_TOOLS.filter((name) => this.capabilities.has(name));
  }

  isUsable(): boolean {
    return [...REQUIRED].every((name) => this.capabilities.has(name));
  }

  diagnostics(): string {
    return this.client.diagnostics();
  }

  markPublished(): number {
    this.publicationGeneration += 1;
    return this.publicationGeneration;
  }

  async nativeTool(
    toolCallId: string,
    name: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<AgentToolResult<GraphifyEvidenceDetails>> {
    if (name === "refresh_graph") {
      const refreshed = await this.refresh(signal);
      return {
        content: [{ type: "text", text: JSON.stringify(refreshed) }],
        details: {
          kind: "second-brain.graphify",
          schemaVersion: 1,
          projectRoot: this.projectRoot,
          backendTool: name,
          toolCallId,
          emittedNodeIds: [],
          evidenceEligible: false,
          truncated: false,
          success: true,
        },
      };
    }
    return this.queue.run(async () => {
      await this.initialize(signal);
      if (!this.capabilities.has(name)) throw new SecondBrainError("TOOL_UNAVAILABLE", `Graphify does not provide ${name}.`);
      let before: Awaited<ReturnType<typeof readGraph>> | undefined;
      try { before = await readGraph(this.projectRoot); } catch { before = undefined; }
      let result;
      try {
        result = await this.client.call(name, { ...params, project_path: this.projectRoot }, { signal, timeout: READ_TIMEOUT_MS });
      } catch (error) {
        if (name === "refresh_graph" || signal?.aborted) throw error;
        await this.resetClient();
        await this.initialize(signal);
        result = await this.client.call(name, { ...params, project_path: this.projectRoot }, { signal, timeout: READ_TIMEOUT_MS });
      }
      const backendError = `Error executing ${name}: `;
      if (name !== "refresh_graph" && result.text.startsWith(backendError)
        && /(?:Graph file not found|graph\.json not found):/.test(result.text)) {
        await this.performRefresh(signal);
        result = await this.client.call(name, { ...params, project_path: this.projectRoot }, { signal, timeout: READ_TIMEOUT_MS });
      }
      if (result.isError) throw new SecondBrainError("BACKEND_TOOL_ERROR", result.text || `${name} failed.`);
      if (result.text.startsWith(backendError)) throw new SecondBrainError("BACKEND_TOOL_ERROR", result.text.slice(backendError.length));
      const retained = truncateUtf8Records(result.text);
      let after: Awaited<ReturnType<typeof readGraph>> | undefined;
      try { after = await readGraph(this.projectRoot); } catch { after = undefined; }
      const stable = Boolean(before && after && before.sha256 === after.sha256);
      const ids = stable ? emittedNodeIds(name, retained.text, after!.document) : [];
      const evidenceEligible = name !== "refresh_graph" && name !== "graph_stats";
      const details: GraphifyEvidenceDetails = {
        kind: "second-brain.graphify",
        schemaVersion: 1,
        projectRoot: this.projectRoot,
        backendTool: name,
        toolCallId,
        ...(stable ? { graphSha256: after!.sha256 } : {}),
        emittedNodeIds: ids,
        evidenceEligible,
        truncated: retained.truncated,
        success: true,
      };
      return { content: [{ type: "text", text: retained.text }], details };
    });
  }

  async refreshAfter(requiredGeneration: number, signal?: AbortSignal): Promise<RefreshResult> {
    if (this.refreshPromise) {
      const existing = this.refreshPromise;
      const result = await existing.promise;
      if (existing.startedAtGeneration >= requiredGeneration) return result;
    }
    const startedAtGeneration = this.publicationGeneration;
    const promise = this.queue.run(() => this.performRefresh(signal));
    this.refreshPromise = { startedAtGeneration, promise };
    try {
      const result = await promise;
      if (startedAtGeneration < requiredGeneration) return this.refreshAfter(requiredGeneration, signal);
      return result;
    } finally {
      if (this.refreshPromise?.promise === promise) this.refreshPromise = undefined;
    }
  }

  async refresh(signal?: AbortSignal): Promise<RefreshResult> {
    return this.refreshAfter(this.publicationGeneration, signal);
  }

  private async performRefresh(signal?: AbortSignal): Promise<RefreshResult> {
    await this.initialize(signal);
    const result = await this.client.call("refresh_graph", { project_path: this.projectRoot }, { signal, timeout: REFRESH_TIMEOUT_MS });
    if (result.isError) throw new SecondBrainError("REFRESH_FAILED", result.text || "Graphify refresh failed.");
    let parsed: unknown;
    try { parsed = JSON.parse(result.text); } catch {
      throw new SecondBrainError("REFRESH_INVALID", "Graphify refresh returned malformed JSON.");
    }
    if (!parsed || typeof parsed !== "object") throw new SecondBrainError("REFRESH_INVALID", "Graphify refresh returned no result object.");
    const value = parsed as Record<string, unknown>;
    if (value.ok !== true) throw new SecondBrainError("REFRESH_FAILED", typeof value.error === "string" ? value.error : "Graphify refresh reported failure.");
    for (const key of ["projectPath", "graphPath", "htmlPath"] as const) {
      if (typeof value[key] !== "string" || !value[key]) throw new SecondBrainError("REFRESH_INVALID", `Graphify refresh is missing ${key}.`);
    }
    for (const key of ["nodes", "edges", "memoryNodes", "memoryEdges"] as const) {
      if (!Number.isInteger(value[key]) || Number(value[key]) < 0) throw new SecondBrainError("REFRESH_INVALID", `Graphify refresh has an invalid ${key} count.`);
    }
    await assertReturnedRefreshPaths(this.projectRoot, value.projectPath as string, value.graphPath as string, value.htmlPath as string);
    return value as unknown as RefreshResult;
  }

  async close(): Promise<void> {
    await this.client.close();
    this.connection = undefined;
    this.capabilities = new Set();
  }

  private async resetClient(): Promise<void> {
    await this.client.close().catch(() => undefined);
    this.client = new GraphifyClient(this.engine);
    this.connection = undefined;
    this.capabilities = new Set();
  }

  childPid(): number | null {
    return this.client.pid();
  }
}

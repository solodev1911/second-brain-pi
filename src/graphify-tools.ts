import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { ALL_GRAPH_TOOLS, type GraphifyService } from "./graphify-service.js";
import type { PiHost } from "./pi-host.js";
import type { GraphifyEvidenceDetails } from "./types.js";
import { SecondBrainError } from "./types.js";

const QuerySchema = Type.Object({
  question: Type.String({ minLength: 1, maxLength: 2_000 }),
  mode: Type.Optional(Type.Union([Type.Literal("bfs"), Type.Literal("dfs")], { default: "bfs" })),
  depth: Type.Optional(Type.Integer({ minimum: 1, maximum: 6, default: 3 })),
  token_budget: Type.Optional(Type.Integer({ minimum: 200, maximum: 8_000, default: 2_000 })),
  context_filter: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { maxItems: 16 })),
}, { additionalProperties: false });
const EmptySchema = Type.Object({}, { additionalProperties: false });
const LabelSchema = Type.Object({ label: Type.String({ minLength: 1, maxLength: 500 }) }, { additionalProperties: false });
const NeighborsSchema = Type.Object({
  label: Type.String({ minLength: 1, maxLength: 500 }),
  relation_filter: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
}, { additionalProperties: false });
const CommunitySchema = Type.Object({ community_id: Type.Integer({ minimum: 0 }) }, { additionalProperties: false });
const GodNodesSchema = Type.Object({ top_n: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, default: 10 })) }, { additionalProperties: false });
const ShortestPathSchema = Type.Object({
  source: Type.String({ minLength: 1, maxLength: 500 }),
  target: Type.String({ minLength: 1, maxLength: 500 }),
  max_hops: Type.Optional(Type.Integer({ minimum: 1, maximum: 16, default: 8 })),
}, { additionalProperties: false });

type ToolSpec = {
  schema: TSchema;
  label: string;
  description: string;
  defaults?: Record<string, unknown>;
  sequential?: boolean;
};

const SPECS: Record<(typeof ALL_GRAPH_TOOLS)[number], ToolSpec> = {
  query_graph: {
    schema: QuerySchema,
    label: "Query project graph",
    description: "Search the current project's Graphify graph for architecture, dependencies, callers, data flow, or remembered conclusions.",
    defaults: { mode: "bfs", depth: 3, token_budget: 2_000 },
  },
  refresh_graph: {
    schema: EmptySchema,
    label: "Refresh project graph",
    description: "Rebuild the current project's Graphify graph and index Second Brain memory records.",
    sequential: true,
  },
  get_node: { schema: LabelSchema, label: "Get graph node", description: "Get exact details for a Graphify node by label or ID." },
  get_neighbors: { schema: NeighborsSchema, label: "Get graph neighbors", description: "Get direct relationships for a Graphify node." },
  get_community: { schema: CommunitySchema, label: "Get graph community", description: "Inspect a Graphify community by its nonnegative ID." },
  god_nodes: { schema: GodNodesSchema, label: "Get graph hubs", description: "List the most connected project concepts.", defaults: { top_n: 10 } },
  graph_stats: { schema: EmptySchema, label: "Get graph statistics", description: "Get summary counts and confidence statistics for the current project graph." },
  shortest_path: {
    schema: ShortestPathSchema,
    label: "Find graph path",
    description: "Find a bounded directed path between two project concepts.",
    defaults: { max_hops: 8 },
  },
};

function definition<T extends TSchema>(
  name: (typeof ALL_GRAPH_TOOLS)[number],
  spec: ToolSpec & { schema: T },
  getService: () => GraphifyService,
): ToolDefinition<T, GraphifyEvidenceDetails> {
  return {
    name,
    label: spec.label,
    description: spec.description,
    promptSnippet: spec.description,
    parameters: spec.schema,
    ...(spec.sequential ? { executionMode: "sequential" as const } : {}),
    execute: async (toolCallId, params, signal) => {
      if (!Value.Check(spec.schema, params)) throw new SecondBrainError("TOOL_ARGUMENTS_INVALID", `Invalid ${name} arguments.`);
      const normalized = { ...(spec.defaults ?? {}), ...(params as Record<string, unknown>) };
      return getService().nativeTool(toolCallId, name, normalized, signal);
    },
  };
}

export function registerGraphifyTools(host: PiHost, getService: () => GraphifyService): { registered: string[]; collisions: string[] } {
  const existing = new Set(host.allToolNames());
  const registered: string[] = [];
  const collisions: string[] = [];
  for (const name of ALL_GRAPH_TOOLS) {
    if (existing.has(name)) {
      collisions.push(name);
      continue;
    }
    const spec = SPECS[name];
    host.registerTool(definition(name, spec, getService));
    registered.push(name);
  }
  return { registered, collisions };
}

export function desiredActiveTools(current: string[], registered: string[], supported: string[]): string[] {
  const allowed = new Set(supported);
  const secondBrainTools = new Set(registered);
  return [...new Set([...current.filter((name) => !secondBrainTools.has(name)), ...registered.filter((name) => allowed.has(name))])];
}

export type QueryGraphInput = Static<typeof QuerySchema>;

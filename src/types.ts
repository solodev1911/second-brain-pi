export type StartupRefresh = "background" | "off";

export interface EngineConfig {
  command: string;
  args: string[];
  cwd?: string;
  source: "flags" | "project-config" | "environment" | "path";
}

export interface SecondBrainProjectConfig {
  schemaVersion: 1;
  graphify: {
    command: string;
    args?: string[];
    cwd?: string;
  };
  startupRefresh?: StartupRefresh;
}

export interface ResolvedConfig {
  engine: EngineConfig;
  startupRefresh: StartupRefresh;
  projectConfigPath?: string;
}

export interface GraphifyEvidenceDetails {
  kind: "second-brain.graphify";
  schemaVersion: 1;
  projectRoot: string;
  backendTool: string;
  toolCallId: string;
  graphSha256?: string;
  emittedNodeIds: string[];
  evidenceEligible: boolean;
  truncated: boolean;
  success: boolean;
}

export interface CaptureSnapshot {
  sessionId: string;
  sessionGeneration: number;
  projectRoot: string;
  userEntryId: string;
  answerEntryId: string;
  sourceAnswerSha256: string;
  question: string;
  answer: string;
  allowedNodeIds: string[];
  evidenceText: string;
  supplementaryText: string;
  capturedAt: string;
}

export interface DistilledMemory {
  question: string;
  summary: string;
  answer: string;
  sourceNodes: string[];
}

export interface MemoryRecord extends DistilledMemory {
  date: string;
  contributor: "pi";
}

export interface PublicationResult {
  absolutePath: string;
  relativePath: string;
  sha256: string;
  deduplicated: boolean;
}

export type RefreshStatus = "indexed" | "failed" | "unverified";

export interface CaptureReceipt {
  schemaVersion: 1;
  projectRoot: string;
  sessionId: string;
  userEntryId: string;
  answerEntryId: string;
  sourceAnswerSha256: string;
  memoryFileSha256: string;
  savedFile: string;
  capturedAt: string;
  deduplicated: boolean;
  usedFallback: boolean;
  truncated: boolean;
  redacted: boolean;
  refreshStatus: RefreshStatus;
  memoryLinks?: number;
  warning?: string;
}

export interface RefreshResult {
  ok: true;
  projectPath: string;
  graphPath: string;
  htmlPath: string;
  nodes: number;
  edges: number;
  memoryNodes: number;
  memoryEdges: number;
}

export interface MemoryVerification {
  status: "indexed" | "unverified";
  memoryLinks?: number;
  warning?: string;
}

export interface GraphNode {
  id: string;
  label?: string;
  norm_label?: string;
  source_file?: string;
  source_location?: string;
  metadata?: Record<string, unknown>;
  kind?: string;
  question?: string;
  summary?: string;
  [key: string]: unknown;
}

export interface GraphLink {
  source: string | { id?: string };
  target: string | { id?: string };
  relation?: string;
  [key: string]: unknown;
}

export interface GraphDocument {
  nodes: GraphNode[];
  links?: GraphLink[];
  edges?: GraphLink[];
  [key: string]: unknown;
}

export interface TextToolResult {
  text: string;
  isError: boolean;
}

export class SecondBrainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SecondBrainError";
  }
}

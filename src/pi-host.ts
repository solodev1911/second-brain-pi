import { randomUUID } from "node:crypto";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  SessionEntry,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import type { CompletionAdapter } from "./distillation.js";
import { SecondBrainError } from "./types.js";

export type PiNoticeLevel = "info" | "warning" | "error";
export type PiExtensionFactoryApi = ExtensionAPI;
export type PiStringFlagName =
  | "second-brain-graphify-command"
  | "second-brain-graphify-engine-root"
  | "second-brain-project-root"
  | "second-brain-startup-refresh";

type MaybePromise<T> = T | Promise<T>;

/**
 * Stable view of the installed Pi context used by Second Brain's session lifecycle.
 * Pi host objects stay private so version-sensitive access remains in this file.
 */
export class PiSessionContext {
  constructor(protected readonly context: ExtensionContext) {}

  cwd(): string {
    return this.context.cwd;
  }

  isProjectTrusted(): boolean {
    return this.context.isProjectTrusted();
  }

  branchEntries(): SessionEntry[] {
    return this.context.sessionManager.getBranch();
  }

  sessionId(): string {
    return this.context.sessionManager.getSessionId();
  }

  notify(message: string, level: PiNoticeLevel = "info"): void {
    this.context.ui.notify(message, level);
  }

  setStatus(key: string, value: string | undefined): void {
    this.context.ui.setStatus(key, value);
  }
}

/** Command-only Pi capabilities, including the isolated nested completion. */
export class PiCommandContext extends PiSessionContext {
  declare protected readonly context: ExtensionCommandContext;

  constructor(context: ExtensionCommandContext) {
    super(context);
    this.context = context;
  }

  supportsRemember(): boolean {
    return this.context.mode === "tui" || this.context.mode === "rpc";
  }

  isCaptureReady(): boolean {
    return this.context.isIdle() && !this.context.hasPendingMessages();
  }

  completionAdapter(): CompletionAdapter {
    return async (systemPrompt, userPrompt, signal) => {
      const model = this.context.model;
      if (!model) throw new SecondBrainError("MODEL_UNAVAILABLE", "No active Pi model is selected.");
      if (!this.context.modelRegistry.hasConfiguredAuth(model)) {
        throw new SecondBrainError("MODEL_UNAVAILABLE", "The active Pi model has no configured authentication.");
      }
      const response = await this.context.modelRegistry.complete(
        model,
        {
          systemPrompt,
          messages: [{ role: "user", content: [{ type: "text", text: userPrompt }], timestamp: Date.now() }],
        },
        {
          signal,
          timeoutMs: 60_000,
          maxRetries: 0,
          maxTokens: 8_000,
          cacheRetention: "none",
          sessionId: randomUUID(),
        },
      );
      if (response.stopReason !== "stop") {
        throw new SecondBrainError("MODEL_FAILED", `Nested completion ended with ${response.stopReason}.`);
      }
      return response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
    };
  }
}

/**
 * Compatibility boundary for the installed Pi extension API (verified at
 * 0.85.1). Domain modules should consume this adapter rather than call Pi.
 */
export class PiHost {
  constructor(private readonly api: ExtensionAPI) {}

  registerStringFlag(name: PiStringFlagName, description: string): void {
    this.api.registerFlag(name, { type: "string", description });
  }

  stringFlag(name: PiStringFlagName): string | undefined {
    const value = this.api.getFlag(name);
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  }

  registerTool<TParams extends TSchema, TDetails, TState>(
    definition: ToolDefinition<TParams, TDetails, TState>,
  ): void {
    this.api.registerTool(definition);
  }

  allToolNames(): string[] {
    return this.api.getAllTools().map((tool) => tool.name);
  }

  activeToolNames(): string[] {
    return this.api.getActiveTools();
  }

  setActiveToolNames(names: string[]): void {
    this.api.setActiveTools(names);
  }

  appendAuditEntry<T>(customType: string, data: T): void {
    this.api.appendEntry(customType, data);
  }

  registerCommand(
    name: string,
    description: string,
    handler: (args: string, context: PiCommandContext) => Promise<void>,
  ): void {
    this.api.registerCommand(name, {
      description,
      handler: (args, context) => handler(args, new PiCommandContext(context)),
    });
  }

  onSessionStart(handler: (context: PiSessionContext) => MaybePromise<void>): void {
    this.api.on("session_start", (_event, context) => handler(new PiSessionContext(context)));
  }

  onSessionShutdown(handler: () => MaybePromise<void>): void {
    this.api.on("session_shutdown", () => handler());
  }

  onSessionTree(handler: () => MaybePromise<void>): void {
    this.api.on("session_tree", () => handler());
  }

  onSessionBeforeCompact(handler: () => MaybePromise<void>): void {
    this.api.on("session_before_compact", () => handler());
  }

  onSessionCompact(handler: () => MaybePromise<void>): void {
    this.api.on("session_compact", () => handler());
  }

  onSessionCompactFailed(handler: () => MaybePromise<void>): void {
    this.api.on("session_compact_failed", () => handler());
  }

  onAgentStart(handler: () => MaybePromise<void>): void {
    this.api.on("agent_start", () => handler());
  }

  onAgentSettled(handler: () => MaybePromise<void>): void {
    this.api.on("agent_settled", () => handler());
  }

  onBeforeAgentStart(handler: (systemPrompt: string) => MaybePromise<string>): void {
    this.api.on("before_agent_start", async (event) => ({ systemPrompt: await handler(event.systemPrompt) }));
  }
}

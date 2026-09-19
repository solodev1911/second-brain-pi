import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveConfig, type ConfigInputs } from "../src/config.js";
import { STATUS_KEY } from "../src/constants.js";
import { doctorReport } from "../src/doctor.js";
import { groundingPrompt } from "../src/grounding.js";
import { GraphifyService } from "../src/graphify-service.js";
import { desiredActiveTools, registerGraphifyTools } from "../src/graphify-tools.js";
import { PiHost, type PiExtensionFactoryApi, type PiSessionContext } from "../src/pi-host.js";
import { resolveProjectRoot } from "../src/project-root.js";
import { RememberCoordinator, validateSnapshotStillCurrent } from "../src/remember.js";
import { statusReport } from "../src/status.js";
import { selectCaptureSnapshot } from "../src/turn-selection.js";
import type { ResolvedConfig } from "../src/types.js";
import { SecondBrainError } from "../src/types.js";

const BUNDLED_GRAPHIFY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "graphify");

type RuntimeState = {
  generation: number;
  abort: AbortController;
  projectRoot?: string;
  config?: ResolvedConfig;
  service?: GraphifyService;
  connection?: Promise<Set<string>>;
  error?: string;
  settled: boolean;
  compacting: boolean;
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function secondBrain(api: PiExtensionFactoryApi): void {
  const host = new PiHost(api);
  host.registerStringFlag("second-brain-graphify-command", "Trusted Graphify MCP executable");
  host.registerStringFlag("second-brain-graphify-engine-root", "Graphify checkout containing its .venv");
  host.registerStringFlag("second-brain-project-root", "Explicit trusted project root");
  host.registerStringFlag("second-brain-startup-refresh", "background or off");

  let state: RuntimeState = { generation: 0, abort: new AbortController(), settled: true, compacting: false };
  const coordinator = new RememberCoordinator();
  let registration: { registered: string[]; collisions: string[] } = { registered: [], collisions: [] };
  let toolsRegistered = false;
  const getService = () => {
    if (!state.service) throw new SecondBrainError("SECOND_BRAIN_UNAVAILABLE", state.error ?? "Second Brain is not configured for this session.");
    return state.service;
  };

  const requiredCollision = () => registration.collisions.some((name) => name === "query_graph" || name === "refresh_graph");

  async function configure(ctx: PiSessionContext): Promise<void> {
    state.abort.abort();
    await state.service?.close().catch(() => undefined);
    const generation = state.generation + 1;
    state = { generation, abort: new AbortController(), settled: true, compacting: false };
    try {
      if (!toolsRegistered) {
        registration = registerGraphifyTools(host, getService);
        toolsRegistered = true;
      }
      host.setActiveToolNames(desiredActiveTools(host.activeToolNames(), registration.registered, []));
      const explicitRoot = host.stringFlag("second-brain-project-root") ?? (process.env.SECOND_BRAIN_PROJECT_ROOT?.trim() || undefined);
      const flagCommand = host.stringFlag("second-brain-graphify-command");
      const flagEngineRoot = host.stringFlag("second-brain-graphify-engine-root");
      const flagStartupRefresh = host.stringFlag("second-brain-startup-refresh");
      const projectRoot = resolveProjectRoot({ cwd: ctx.cwd(), trusted: ctx.isProjectTrusted(), ...(explicitRoot ? { explicitRoot } : {}) });
      const configInputs: ConfigInputs = {
        projectRoot,
        bundledEngineRoot: BUNDLED_GRAPHIFY_ROOT,
        environment: process.env,
        ...(flagCommand ? { flagCommand } : {}),
        ...(flagEngineRoot ? { flagEngineRoot } : {}),
        ...(flagStartupRefresh ? { flagStartupRefresh } : {}),
      };
      const config = resolveConfig(configInputs);
      const service = new GraphifyService(projectRoot, config.engine);
      state = { ...state, projectRoot, config, service };
      if (requiredCollision()) {
        state.error = `Required Pi tool name collision: ${registration.collisions.filter((name) => name === "query_graph" || name === "refresh_graph").join(", ")}. Existing tools were not overwritten.`;
      }
      const connection = service.initialize(state.abort.signal);
      state.connection = connection;
      void connection.then((supported) => {
        if (state.generation !== generation) return;
        host.setActiveToolNames(desiredActiveTools(host.activeToolNames(), registration.registered, requiredCollision() ? [] : [...supported]));
        if (config.startupRefresh === "background") {
          ctx.setStatus(STATUS_KEY, "Second Brain: refreshing graph");
          void service.refresh(state.abort.signal)
            .catch((error) => { if (state.generation === generation) state.error = message(error); })
            .finally(() => { if (state.generation === generation) ctx.setStatus(STATUS_KEY, undefined); });
        }
      }).catch((error) => {
        if (state.generation === generation) state.error = message(error);
      });
    } catch (error) {
      state.error = message(error);
      host.setActiveToolNames(desiredActiveTools(host.activeToolNames(), registration.registered, []));
    }
  }

  host.onSessionStart(configure);
  host.onSessionShutdown(async () => {
    state.generation += 1;
    state.abort.abort();
    await state.service?.close().catch(() => undefined);
  });
  host.onSessionTree(() => {
    state.generation += 1;
    state.abort.abort();
    state.abort = new AbortController();
  });
  host.onSessionBeforeCompact(() => { state.compacting = true; });
  host.onSessionCompact(() => { state.compacting = false; state.generation += 1; });
  host.onSessionCompactFailed(() => { state.compacting = false; });
  host.onAgentStart(() => { state.settled = false; });
  host.onAgentSettled(() => { state.settled = true; });

  host.onBeforeAgentStart((systemPrompt) => groundingPrompt(systemPrompt, requiredCollision() ? undefined : state.connection, state.service));

  host.registerCommand(
    "memory-status",
    "Show Second Brain project, engine, graph, and last-capture status",
    async (_args, ctx) => {
      ctx.notify(await statusReport({
        entries: ctx.branchEntries(),
        collisions: registration.collisions,
        ...(state.projectRoot ? { projectRoot: state.projectRoot } : {}),
        ...(state.config ? { config: state.config } : {}),
        ...(state.service ? { service: state.service } : {}),
        ...(state.error ? { error: state.error } : {}),
      }), state.service?.isUsable() && !requiredCollision() ? "info" : "warning");
    },
  );

  host.registerCommand(
    "second-brain-doctor",
    "Check Second Brain installation, project access, runtime, and Graphify connectivity",
    async (args, ctx) => {
      if (args.trim()) { ctx.notify("Usage: /second-brain-doctor", "warning"); return; }
      await state.connection?.catch(() => undefined);
      const report = await doctorReport({
        bundledEngineRoot: BUNDLED_GRAPHIFY_ROOT,
        collisions: registration.collisions,
        ...(state.projectRoot ? { projectRoot: state.projectRoot } : {}),
        ...(state.config ? { config: state.config } : {}),
        ...(state.service ? { service: state.service } : {}),
        ...(state.error ? { error: state.error } : {}),
      });
      ctx.notify(report, state.service?.isUsable() && !requiredCollision() ? "info" : "warning");
    },
  );

  host.registerCommand(
    "graph-refresh",
    "Refresh Graphify and re-index Second Brain memories for this project",
    async (args, ctx) => {
      if (args.trim()) { ctx.notify("Usage: /graph-refresh", "warning"); return; }
      if (!state.service) { ctx.notify(state.error ?? "Second Brain is unavailable. Run /memory-status.", "error"); return; }
      ctx.setStatus(STATUS_KEY, "Second Brain: refreshing graph");
      try {
        const result = await state.service.refresh(state.abort.signal);
        state.error = undefined;
        ctx.notify(`Graph refreshed: ${result.nodes} nodes, ${result.edges} edges, ${result.memoryNodes} memories, ${result.memoryEdges} memory links.`, "info");
      } catch (error) {
        state.error = message(error);
        ctx.notify(`Graph refresh failed: ${state.error}`, "error");
      } finally {
        ctx.setStatus(STATUS_KEY, undefined);
      }
    },
  );

  host.registerCommand(
    "remember",
    "Save the latest completed answer to this project's Graphify-backed memory",
    async (args, ctx) => {
      if (args.trim()) { ctx.notify("Usage: /remember", "warning"); return; }
      if (!ctx.supportsRemember()) { ctx.notify("/remember is supported in TUI and RPC modes only; nothing was saved.", "warning"); return; }
      if (!state.service || !state.projectRoot) { ctx.notify(state.error ?? "Second Brain is unavailable. Run /memory-status.", "error"); return; }
      if (!ctx.isCaptureReady() || !state.settled || state.compacting) {
        ctx.notify("Nothing saved: wait for the current answer and queued work to settle, then run /remember.", "warning");
        return;
      }
      const approvedGeneration = state.generation;
      const approvedSession = ctx.sessionId();
      const entries = ctx.branchEntries();
      let snapshot;
      try {
        snapshot = selectCaptureSnapshot({
          entries,
          sessionId: approvedSession,
          sessionGeneration: approvedGeneration,
          projectRoot: state.projectRoot,
        });
      } catch (error) {
        ctx.notify(`Nothing saved: ${message(error)}`, "warning");
        return;
      }
      ctx.setStatus(STATUS_KEY, "Second Brain: saving latest answer");
      try {
        const outcome = await coordinator.capture(
          snapshot,
          entries,
          ctx.completionAdapter(),
          state.service,
          async () => {
            if (state.generation !== approvedGeneration || state.projectRoot !== snapshot.projectRoot
              || ctx.sessionId() !== approvedSession || state.abort.signal.aborted) {
              throw new SecondBrainError("CAPTURE_INVALIDATED", "The session, branch, or project changed before publication.");
            }
            validateSnapshotStillCurrent(snapshot, ctx.branchEntries(), approvedSession, approvedGeneration);
          },
          state.abort.signal,
        );
        if (state.generation !== approvedGeneration || ctx.sessionId() !== approvedSession) return;
        if (state.generation === approvedGeneration && ctx.sessionId() === approvedSession) {
          try { host.appendAuditEntry("second-brain.capture.v1", outcome.receipt); }
          catch { ctx.notify(`Saved ${outcome.publication.relativePath}, but the session audit entry could not be appended.`, "warning"); }
        }
        const prefix = outcome.publication.deduplicated ? "Already saved" : "Saved";
        const index = outcome.receipt.refreshStatus === "indexed"
          ? `indexed with ${outcome.receipt.memoryLinks ?? 0} verified source link(s)`
          : outcome.receipt.refreshStatus === "failed" ? "saved but not indexed; run /graph-refresh" : "refresh completed but indexing was not verified";
        const fallback = outcome.receipt.usedFallback ? ` Fallback used${outcome.receipt.warning ? `: ${outcome.receipt.warning}` : "."}` : "";
        ctx.notify(`${prefix}: ${outcome.publication.relativePath} (${index}).${fallback}`, outcome.receipt.refreshStatus === "indexed" ? "info" : "warning");
      } catch (error) {
        ctx.notify(`Nothing saved: ${message(error)}`, "error");
      } finally {
        ctx.setStatus(STATUS_KEY, undefined);
      }
    },
  );
}

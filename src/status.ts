import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { access } from "node:fs/promises";
import path from "node:path";
import { RECEIPT_CUSTOM_TYPE, truncateCodePoints } from "./constants.js";
import type { ResolvedConfig, CaptureReceipt } from "./types.js";
import type { GraphifyService } from "./graphify-service.js";

function latestReceipt(entries: SessionEntry[], projectRoot: string): CaptureReceipt | undefined {
  for (const entry of [...entries].reverse()) {
    if (entry.type !== "custom" || entry.customType !== RECEIPT_CUSTOM_TYPE || !entry.data || typeof entry.data !== "object") continue;
    const value = entry.data as Partial<CaptureReceipt>;
    if (value.schemaVersion === 1 && value.projectRoot === projectRoot && typeof value.savedFile === "string") return value as CaptureReceipt;
  }
  return undefined;
}

async function exists(file: string): Promise<boolean> {
  try { await access(file); return true; } catch { return false; }
}

export async function statusReport(input: {
  projectRoot?: string;
  config?: ResolvedConfig;
  service?: GraphifyService;
  entries: SessionEntry[];
  collisions: string[];
  error?: string;
}): Promise<string> {
  if (!input.projectRoot || !input.config) {
    return `Second Brain: unavailable\n${truncateCodePoints(input.error ?? "Project is not trusted or configuration could not be resolved.", 1_000)}\nNext: start Pi inside the trusted project and run /memory-status again.`;
  }
  const graph = path.join(input.projectRoot, "graphify-out", "graph.json");
  const memory = path.join(input.projectRoot, "graphify-out", "memory");
  const receipt = latestReceipt(input.entries, input.projectRoot);
  const safeArgs = input.config.engine.args.every((arg) => ["-m", "graphify.serve"].includes(arg))
    ? input.config.engine.args.join(" ")
    : input.config.engine.args.length ? `[${input.config.engine.args.length} configured argument(s) hidden]` : "";
  const engine = input.config.engine.source === "bundled-uv"
    ? "uv (locked bundled Graphify)"
    : `${input.config.engine.command}${safeArgs ? ` ${safeArgs}` : ""}`;
  const requiredCollision = input.collisions.some((name) => name === "query_graph" || name === "refresh_graph");
  const state = input.service?.isUsable() && !requiredCollision ? "connected" : "not connected";
  const lines = [
    `Second Brain: ${state}`,
    `Project: ${input.projectRoot}`,
    `Engine: ${engine} (source: ${input.config.engine.source})`,
    ...(input.config.engine.cwd ? [`Engine cwd: ${input.config.engine.cwd}`] : []),
    `Graph: ${await exists(graph) ? "present" : "missing"}`,
    `Memory directory: ${await exists(memory) ? "present" : "not created"}`,
  ];
  if (input.collisions.length) lines.push(`Tool collisions (not overwritten): ${input.collisions.join(", ")}`);
  if (receipt) lines.push(`Last capture: ${receipt.savedFile} (${receipt.refreshStatus}${receipt.memoryLinks === undefined ? "" : `, ${receipt.memoryLinks} link(s)`})`);
  if (input.error) lines.push(`Diagnostic: ${truncateCodePoints(input.error, 1_000)}`);
  if (requiredCollision) lines.push("Next: disable or rename the conflicting required tool, then restart Pi.");
  else if (!input.service?.isUsable()) {
    lines.push(input.config.engine.source === "bundled-uv"
      ? "Next: run /second-brain-doctor. First setup requires uv on PATH and internet access to download the locked runtime."
      : `Next: verify locally with: ${engine} --help`);
  }
  return lines.join("\n");
}

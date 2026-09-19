import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { truncateCodePoints } from "./constants.js";
import type { GraphifyService } from "./graphify-service.js";
import { BUNDLED_GRAPHIFY_REQUIRED_FILES, findExecutable } from "./runtime.js";
import type { ResolvedConfig } from "./types.js";

type CheckLevel = "PASS" | "WARN" | "FAIL";

interface DoctorCheck {
  level: CheckLevel;
  name: string;
  detail: string;
  next?: string;
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function isWritable(directory: string): Promise<boolean> {
  try {
    await access(directory, fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function commandNext(source: ResolvedConfig["engine"]["source"], command: string): string {
  if (source === "bundled-uv") {
    return "Install uv from https://docs.astral.sh/uv/getting-started/installation/ and restart Pi.";
  }
  if (source === "path") {
    return "Reinstall Second Brain so its bundled Graphify runtime is present, or install graphify-mcp on PATH.";
  }
  return `Fix the configured Graphify command (${command}) or remove that override to use the bundled runtime.`;
}

function format(check: DoctorCheck): string[] {
  return [
    `[${check.level}] ${check.name}: ${check.detail}`,
    ...(check.next ? [`       Next: ${check.next}`] : []),
  ];
}

export async function doctorReport(input: {
  projectRoot?: string;
  config?: ResolvedConfig;
  service?: GraphifyService;
  bundledEngineRoot: string;
  collisions: string[];
  error?: string;
  environment?: NodeJS.ProcessEnv;
}): Promise<string> {
  const checks: DoctorCheck[] = [];
  const environment = input.environment ?? process.env;

  if (input.projectRoot) {
    checks.push({ level: "PASS", name: "Project", detail: input.projectRoot });
    const writable = await isWritable(input.projectRoot);
    checks.push(writable
      ? { level: "PASS", name: "Project storage", detail: "writable" }
      : {
          level: "FAIL",
          name: "Project storage",
          detail: "not writable",
          next: `Grant write access to ${input.projectRoot}; Second Brain writes graphify-out/ there.`,
        });
    const graph = path.join(input.projectRoot, "graphify-out", "graph.json");
    checks.push(await exists(graph)
      ? { level: "PASS", name: "Graph", detail: graph }
      : { level: "WARN", name: "Graph", detail: "not created yet", next: "Run /graph-refresh after the runtime is connected." });
  } else {
    checks.push({
      level: "FAIL",
      name: "Project",
      detail: "not available or not trusted",
      next: "Start Pi inside the repository and approve project trust, then restart Pi.",
    });
  }

  const missingBundled = (await Promise.all(BUNDLED_GRAPHIFY_REQUIRED_FILES.map(async (file) => ({
    file,
    present: await exists(path.join(input.bundledEngineRoot, file)),
  })))).filter((entry) => !entry.present).map((entry) => entry.file);
  checks.push(missingBundled.length === 0
    ? { level: "PASS", name: "Bundled Graphify", detail: input.bundledEngineRoot }
    : {
        level: "WARN",
        name: "Bundled Graphify",
        detail: `missing ${missingBundled.join(", ")}`,
        next: "Reinstall Second Brain from its published package.",
      });

  if (input.config) {
    const engine = input.config.engine;
    checks.push({ level: "PASS", name: "Configuration", detail: `engine source is ${engine.source}` });
    const executable = await findExecutable(engine.command, environment);
    checks.push(executable
      ? { level: "PASS", name: "Runtime command", detail: executable }
      : {
          level: "FAIL",
          name: "Runtime command",
          detail: `${engine.command} was not found or is not executable`,
          next: commandNext(engine.source, engine.command),
        });
  } else {
    checks.push({
      level: "FAIL",
      name: "Configuration",
      detail: "could not be resolved",
      next: "Run /memory-status for the configuration error, correct it, and restart Pi.",
    });
  }

  const requiredCollisions = input.collisions.filter((name) => name === "query_graph" || name === "refresh_graph");
  if (requiredCollisions.length) {
    checks.push({
      level: "FAIL",
      name: "Pi tools",
      detail: `required name collision: ${requiredCollisions.join(", ")}`,
      next: "Disable or rename the conflicting extension, then restart Pi.",
    });
  } else if (input.collisions.length) {
    checks.push({
      level: "WARN",
      name: "Pi tools",
      detail: `optional name collision: ${input.collisions.join(", ")}`,
      next: "Disable or rename the conflicting extension to expose every Graphify tool.",
    });
  } else {
    checks.push({ level: "PASS", name: "Pi tools", detail: "no name collisions" });
  }

  if (input.service?.isUsable() && requiredCollisions.length === 0) {
    checks.push({
      level: "PASS",
      name: "Graphify MCP",
      detail: `connected (${input.service.supportedTools().length} graph tool(s))`,
    });
  } else {
    checks.push({
      level: "FAIL",
      name: "Graphify MCP",
      detail: "not connected",
      next: input.config?.engine.source === "bundled-uv"
        ? "Confirm internet access for the first locked uv setup, then restart Pi and run /second-brain-doctor again."
        : "Correct the runtime issue above, then restart Pi and run /second-brain-doctor again.",
    });
  }

  if (input.error) {
    checks.push({ level: "FAIL", name: "Last runtime error", detail: truncateCodePoints(input.error, 1_000) });
  }

  const failures = checks.filter((check) => check.level === "FAIL").length;
  const warnings = checks.filter((check) => check.level === "WARN").length;
  const summary = failures === 0
    ? warnings === 0 ? "READY" : `READY WITH ${warnings} WARNING${warnings === 1 ? "" : "S"}`
    : `NOT READY (${failures} FAILURE${failures === 1 ? "" : "S"})`;
  return ["Second Brain Doctor", ...checks.flatMap(format), `Result: ${summary}`].join("\n");
}

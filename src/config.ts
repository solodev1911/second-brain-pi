import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { CONFIG_SCHEMA_VERSION } from "./constants.js";
import { bundledUvProfile, hasBundledGraphifySource } from "./runtime.js";
import type { EngineConfig, ResolvedConfig, SecondBrainProjectConfig, StartupRefresh } from "./types.js";
import { SecondBrainError } from "./types.js";

export interface ConfigInputs {
  projectRoot: string;
  flagCommand?: string;
  flagEngineRoot?: string;
  flagStartupRefresh?: string;
  bundledEngineRoot?: string;
  environment?: NodeJS.ProcessEnv;
}

function nonempty(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new SecondBrainError("CONFIG_INVALID", `${name} must be a nonempty string.`);
  }
  return value.trim();
}

function startup(value: unknown, source: string): StartupRefresh {
  if (value === undefined || value === "") return "background";
  if (value === "background" || value === "off") return value;
  throw new SecondBrainError("CONFIG_INVALID", `${source} must be "background" or "off".`);
}

function validateProjectConfig(raw: unknown): SecondBrainProjectConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new SecondBrainError("CONFIG_INVALID", "Project configuration must be a JSON object.");
  }
  const value = raw as Record<string, unknown>;
  if (value.schemaVersion !== CONFIG_SCHEMA_VERSION) {
    throw new SecondBrainError("CONFIG_INVALID", `Project configuration schemaVersion must be ${CONFIG_SCHEMA_VERSION}.`);
  }
  const graphify = value.graphify;
  if (!graphify || typeof graphify !== "object" || Array.isArray(graphify)) {
    throw new SecondBrainError("CONFIG_INVALID", "Project configuration graphify field must be an object.");
  }
  const g = graphify as Record<string, unknown>;
  const command = nonempty(g.command, "graphify.command");
  let args: string[] | undefined;
  if (g.args !== undefined) {
    if (!Array.isArray(g.args) || g.args.some((entry) => typeof entry !== "string")) {
      throw new SecondBrainError("CONFIG_INVALID", "graphify.args must be an array of strings.");
    }
    args = [...(g.args as string[])];
  }
  const cwd = g.cwd === undefined ? undefined : nonempty(g.cwd, "graphify.cwd");
  const startupRefresh = startup(value.startupRefresh, "startupRefresh");
  return {
    schemaVersion: 1,
    graphify: {
      command,
      ...(args ? { args } : {}),
      ...(cwd ? { cwd } : {}),
    },
    startupRefresh,
  };
}

function pythonForRoot(root: string): string | undefined {
  const candidates = process.platform === "win32"
    ? [path.join(root, ".venv", "Scripts", "python.exe")]
    : [path.join(root, ".venv", "bin", "python")];
  return candidates.find(existsSync);
}

function profile(command: string, engineRoot: string | undefined, source: EngineConfig["source"]): EngineConfig {
  if (!engineRoot) return { command, args: [], source };
  const resolvedRoot = path.resolve(engineRoot);
  return {
    command,
    args: command.toLowerCase().includes("graphify-mcp") ? [] : ["-m", "graphify.serve"],
    cwd: resolvedRoot,
    source,
  };
}

export function resolveConfig(inputs: ConfigInputs): ResolvedConfig {
  const env = inputs.environment ?? process.env;
  const projectConfigPath = path.join(inputs.projectRoot, ".pi", "second-brain.json");
  let projectConfig: SecondBrainProjectConfig | undefined;
  if (existsSync(projectConfigPath)) {
    try {
      projectConfig = validateProjectConfig(JSON.parse(readFileSync(projectConfigPath, "utf8")));
    } catch (error) {
      if (error instanceof SecondBrainError) throw error;
      throw new SecondBrainError("CONFIG_INVALID", `Cannot parse ${projectConfigPath}: ${(error as Error).message}`);
    }
  }

  const flagCommand = inputs.flagCommand?.trim();
  const flagRoot = inputs.flagEngineRoot?.trim();
  const envCommand = env.SECOND_BRAIN_GRAPHIFY_COMMAND?.trim();
  const envRoot = env.SECOND_BRAIN_GRAPHIFY_ENGINE_ROOT?.trim();

  let engine: EngineConfig;
  if (flagCommand || flagRoot) {
    const command = flagCommand || (flagRoot ? pythonForRoot(flagRoot) : undefined);
    if (!command) throw new SecondBrainError("CONFIG_INVALID", "The flag engine root has no .venv Python; provide --second-brain-graphify-command.");
    engine = profile(command, flagRoot, "flags");
  } else if (projectConfig) {
    engine = {
      command: projectConfig.graphify.command,
      args: projectConfig.graphify.args ?? [],
      ...(projectConfig.graphify.cwd ? { cwd: projectConfig.graphify.cwd } : {}),
      source: "project-config",
    };
  } else if (envCommand || envRoot) {
    const command = envCommand || (envRoot ? pythonForRoot(envRoot) : undefined);
    if (!command) throw new SecondBrainError("CONFIG_INVALID", "SECOND_BRAIN_GRAPHIFY_ENGINE_ROOT has no .venv Python; set SECOND_BRAIN_GRAPHIFY_COMMAND.");
    engine = profile(command, envRoot, "environment");
  } else {
    const bundledRoot = inputs.bundledEngineRoot?.trim();
    const bundledCommand = bundledRoot ? pythonForRoot(bundledRoot) : undefined;
    if (bundledRoot && bundledCommand) {
      engine = profile(bundledCommand, bundledRoot, "bundled");
    } else if (bundledRoot && hasBundledGraphifySource(bundledRoot)) {
      engine = bundledUvProfile(bundledRoot);
    } else {
      engine = { command: "graphify-mcp", args: [], source: "path" };
    }
  }

  const startupRefresh = startup(
    inputs.flagStartupRefresh ?? projectConfig?.startupRefresh ?? env.SECOND_BRAIN_STARTUP_REFRESH,
    "startup refresh",
  );
  return {
    engine,
    startupRefresh,
    ...(projectConfig ? { projectConfigPath } : {}),
  };
}

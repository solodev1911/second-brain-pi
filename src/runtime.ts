import { constants as fsConstants, existsSync } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import type { EngineConfig } from "./types.js";

export const BUNDLED_GRAPHIFY_REQUIRED_FILES = [
  "pyproject.toml",
  "uv.lock",
  path.join("graphify", "serve.py"),
] as const;

/**
 * A packaged Graphify checkout is usable through uv only when its locked
 * project metadata and MCP entry point are all present. Keeping this check in
 * one place makes a partially packed npm artifact fail closed to PATH.
 */
export function hasBundledGraphifySource(root: string): boolean {
  return BUNDLED_GRAPHIFY_REQUIRED_FILES.every((file) => existsSync(path.join(root, file)));
}

export function bundledUvProfile(root: string): EngineConfig {
  const resolvedRoot = path.resolve(root);
  return {
    command: "uv",
    args: [
      "run",
      "--frozen",
      "--no-dev",
      "--extra",
      "mcp",
      "--project",
      resolvedRoot,
      "python",
      "-m",
      "graphify.serve",
    ],
    cwd: resolvedRoot,
    source: "bundled-uv",
    connectionTimeoutMs: 300_000,
  };
}

function executableCandidates(command: string, environment: NodeJS.ProcessEnv): string[] {
  if (path.isAbsolute(command) || command.includes(path.sep) || (path.sep !== "/" && command.includes("/"))) {
    return [path.resolve(command)];
  }

  const searchPath = environment.PATH ?? environment.Path ?? environment.path ?? "";
  if (!searchPath) return [];
  const extensions = process.platform === "win32"
    ? (environment.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
    : [""];
  const hasKnownExtension = process.platform === "win32"
    && extensions.some((extension) => command.toLowerCase().endsWith(extension.toLowerCase()));

  return searchPath.split(path.delimiter).filter(Boolean).flatMap((directory) => {
    if (process.platform !== "win32" || hasKnownExtension) return [path.join(directory, command)];
    return extensions.map((extension) => path.join(directory, `${command}${extension}`));
  });
}

/** Resolve an executable without launching it. Used only for diagnostics. */
export async function findExecutable(
  command: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
  for (const candidate of executableCandidates(command, environment)) {
    try {
      await access(candidate, process.platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK);
      return candidate;
    } catch {
      // Continue searching PATH.
    }
  }
  return undefined;
}

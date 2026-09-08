import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { SecondBrainError } from "./types.js";

function canonicalExisting(input: string): string {
  if (!path.isAbsolute(input)) {
    throw new SecondBrainError("ROOT_NOT_ABSOLUTE", `Project root must be absolute: ${input}`);
  }
  if (!existsSync(input)) {
    throw new SecondBrainError("ROOT_MISSING", `Project root does not exist: ${input}`);
  }
  return realpathSync.native(input);
}

export function samePath(left: string, right: string): boolean {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export function containsPath(parent: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function ancestors(start: string): string[] {
  const result: string[] = [];
  let current = path.resolve(start);
  while (true) {
    result.push(current);
    const parent = path.dirname(current);
    if (parent === current) return result;
    current = parent;
  }
}

export interface ResolveProjectRootOptions {
  cwd: string;
  trusted: boolean;
  explicitRoot?: string;
}

export function resolveProjectRoot(options: ResolveProjectRootOptions): string {
  if (!options.trusted) {
    throw new SecondBrainError("PROJECT_UNTRUSTED", "Second Brain is disabled until Pi trusts this project.");
  }
  const cwd = canonicalExisting(options.cwd);
  let candidate: string | undefined;

  if (options.explicitRoot?.trim()) {
    candidate = canonicalExisting(options.explicitRoot.trim());
  } else {
    const chain = ancestors(cwd);
    candidate = chain.find((entry) => existsSync(path.join(entry, "graphify-out", "graph.json")));
    candidate ??= chain.find((entry) => existsSync(path.join(entry, ".git")));
    candidate ??= cwd;
  }

  if (!containsPath(candidate, cwd)) {
    throw new SecondBrainError(
      "ROOT_OUTSIDE_TRUSTED_SCOPE",
      `Resolved project root ${candidate} is not an ancestor of Pi's trusted cwd ${cwd}. Start Pi inside that project.`,
    );
  }
  return candidate;
}

export function assertContainedExistingAncestor(root: string, candidate: string): void {
  if (!containsPath(root, candidate)) {
    throw new SecondBrainError("PATH_ESCAPE", `Path escapes the project root: ${candidate}`);
  }
  let probe = path.resolve(candidate);
  while (!existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  const canonicalRoot = realpathSync.native(root);
  const canonicalProbe = realpathSync.native(probe);
  if (!containsPath(canonicalRoot, canonicalProbe)) {
    throw new SecondBrainError("SYMLINK_ESCAPE", `Existing ancestor resolves outside the project root: ${probe}`);
  }
}

export function projectRelative(root: string, absolute: string): string {
  if (!containsPath(root, absolute)) throw new SecondBrainError("PATH_ESCAPE", `Path escapes the project root: ${absolute}`);
  return path.relative(root, absolute).split(path.sep).join("/");
}

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

type PackResult = { filename: string; files: Array<{ path: string }> };

const scratch = mkdtempSync(path.join(os.tmpdir(), "second-brain-pack-check-"));
const npmCache = path.join(scratch, "npm-cache");
const project = path.join(scratch, "project");
const piConfig = path.join(scratch, "pi-config");
const staging = path.join(scratch, "staging");
mkdirSync(npmCache);
mkdirSync(project);
mkdirSync(piConfig);
mkdirSync(staging);

try {
  const packed = JSON.parse(execFileSync("npm", ["pack", "--json", "--pack-destination", scratch], {
    encoding: "utf8",
    env: { ...process.env, npm_config_cache: npmCache },
  })) as PackResult[];
  const artifact = packed[0];
  if (!artifact?.filename) throw new Error("npm pack did not produce an artifact");
  const files = artifact.files.map((entry) => entry.path);
  for (const required of [
    "package.json",
    "extensions/second-brain.ts",
    "skills/second-brain/SKILL.md",
    "src/graphify-service.ts",
    "src/pi-host.ts",
    "docs/implementation-progress.md",
  ]) {
    if (!files.includes(required)) throw new Error(`Package is missing ${required}`);
  }
  if (files.some((file) => file.startsWith("tests/") || file.startsWith("node_modules/"))) {
    throw new Error("Package contains tests or node_modules");
  }

  const tarball = path.join(scratch, artifact.filename);
  execFileSync("npm", [
    "install", "--prefix", staging, "--ignore-scripts", "--legacy-peer-deps", "--omit=dev",
    "--no-audit", "--no-fund", tarball,
  ], { env: { ...process.env, npm_config_cache: npmCache }, stdio: "pipe" });
  const installedPackage = path.join(staging, "node_modules", "second-brain");
  const pi = process.env.SECOND_BRAIN_TEST_PI ?? (process.platform === "win32" ? "pi.cmd" : "pi");
  const env = { ...process.env, PI_CODING_AGENT_DIR: piConfig, SECOND_BRAIN_STARTUP_REFRESH: "off" };
  execFileSync(pi, ["install", "-l", installedPackage, "--approve"], { cwd: project, env, stdio: "pipe" });
  const commandsOutput = execFileSync(pi, ["--mode", "rpc", "--offline", "--approve"], {
    cwd: project,
    env,
    input: '{"id":"commands","type":"get_commands"}\n',
    encoding: "utf8",
  });
  const commands = commandsOutput.split(/\r?\n/)
    .filter(Boolean)
    .map((line) => { try { return JSON.parse(line) as Record<string, any>; } catch { return undefined; } })
    .find((event) => event?.type === "response" && event.id === "commands");
  if (!commands?.success) throw new Error(`Packed package failed to load in Pi RPC: ${commandsOutput}`);
  const names = new Set(commands.data.commands.map((command: { name: string }) => command.name));
  for (const required of ["remember", "memory-status", "graph-refresh", "skill:second-brain"]) {
    if (!names.has(required)) throw new Error(`Packed package did not load ${required}`);
  }

  execFileSync(pi, ["remove", "-l", installedPackage, "--approve"], { cwd: project, env, stdio: "pipe" });
  const settings = JSON.parse(readFileSync(path.join(project, ".pi", "settings.json"), "utf8")) as { packages?: string[] };
  if ((settings.packages ?? []).length !== 0) throw new Error("Packed package remained enabled after removal");
  console.log(`Packed artifact verified end to end (${files.length} files): install, Pi load, skill discovery, and removal.`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

type PackResult = { filename: string; files: Array<{ path: string }> };
type RpcEvent = Record<string, any>;

function rpcHarness(child: ChildProcessWithoutNullStreams) {
  const events: RpcEvent[] = [];
  const stderr: string[] = [];
  const waiters: Array<{
    after: number;
    predicate: (event: RpcEvent) => boolean;
    resolve: (event: RpcEvent) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }> = [];

  child.stderr.on("data", (chunk) => stderr.push(String(chunk)));
  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    let event: RpcEvent;
    try { event = JSON.parse(line) as RpcEvent; } catch { return; }
    events.push(event);
    for (const waiter of [...waiters]) {
      if (events.length <= waiter.after || !waiter.predicate(event)) continue;
      waiters.splice(waiters.indexOf(waiter), 1);
      clearTimeout(waiter.timer);
      waiter.resolve(event);
    }
  });

  const diagnostics = () => [
    `Events: ${JSON.stringify(events.slice(-16))}`,
    ...(stderr.length ? [`stderr: ${stderr.join("")}`] : []),
  ].join("\n");

  child.once("exit", (code, signal) => {
    for (const waiter of [...waiters]) {
      waiters.splice(waiters.indexOf(waiter), 1);
      clearTimeout(waiter.timer);
      waiter.reject(new Error(`Pi RPC exited (${code ?? signal ?? "unknown"}). ${diagnostics()}`));
    }
  });

  const waitFor = (
    predicate: (event: RpcEvent) => boolean,
    timeout = 30_000,
    after = 0,
  ): Promise<RpcEvent> => {
    const found = events.slice(after).find(predicate);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const waiter = {
        after,
        predicate,
        resolve,
        reject,
        timer: setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error(`Pi RPC timed out after ${timeout}ms. ${diagnostics()}`));
        }, timeout),
      };
      waiters.push(waiter);
    });
  };

  const request = async (value: RpcEvent, timeout = 30_000): Promise<RpcEvent> => {
    const after = events.length;
    child.stdin.write(`${JSON.stringify(value)}\n`);
    const response = await waitFor(
      (event) => event.type === "response" && event.id === value.id,
      timeout,
      after,
    );
    if (response.success !== true) {
      throw new Error(`Pi RPC request ${String(value.id)} failed. ${diagnostics()}`);
    }
    return response;
  };

  const stop = async (): Promise<void> => {
    if (child.exitCode !== null) return;
    child.stdin.end();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { child.kill("SIGTERM"); resolve(); }, 5_000);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
    });
  };

  return { diagnostics, events, request, stop };
}

const packageManifest = JSON.parse(readFileSync(path.resolve("package.json"), "utf8")) as { name?: string };
if (!packageManifest.name) throw new Error("package.json is missing name");

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
    "src/runtime.ts",
    "src/doctor.ts",
    "LICENSE",
    "NOTICE",
    "THIRD_PARTY_NOTICES.md",
    "graphify/pyproject.toml",
    "graphify/uv.lock",
    "graphify/graphify/serve.py",
    "graphify/graphify/memory_links.py",
    "graphify/LICENSE",
    "graphify/NOTICE",
  ]) {
    if (!files.includes(required)) throw new Error(`Package is missing ${required}`);
  }
  if (files.some((file) => file.startsWith("tests/") || file.startsWith("graphify/tests/") || file.startsWith("node_modules/"))) {
    throw new Error("Package contains tests or node_modules");
  }

  const tarball = path.join(scratch, artifact.filename);
  execFileSync("npm", [
    "install", "--prefix", staging, "--ignore-scripts", "--legacy-peer-deps", "--omit=dev",
    "--no-audit", "--no-fund", tarball,
  ], { env: { ...process.env, npm_config_cache: npmCache }, stdio: "pipe" });
  const installedPackage = path.join(staging, "node_modules", ...packageManifest.name.split("/"));
  if (!existsSync(path.join(installedPackage, "graphify", "graphify", "serve.py"))) {
    throw new Error("Installed package is missing the Graphify runtime");
  }
  const pi = process.env.SECOND_BRAIN_TEST_PI ?? (process.platform === "win32" ? "pi.cmd" : "pi");
  const env = { ...process.env, PI_CODING_AGENT_DIR: piConfig, SECOND_BRAIN_STARTUP_REFRESH: "off" };
  execFileSync(pi, ["install", "-l", installedPackage, "--approve"], { cwd: project, env, stdio: "pipe" });
  const child = spawn(pi, ["--mode", "rpc", "--offline", "--approve"], { cwd: project, env });
  const rpc = rpcHarness(child);
  try {
    const commands = await rpc.request({ id: "commands", type: "get_commands" });
    const names = new Set(commands.data.commands.map((command: { name: string }) => command.name));
    for (const required of ["remember", "memory-status", "second-brain-doctor", "graph-refresh", "skill:second-brain"]) {
      if (!names.has(required)) throw new Error(`Packed package did not load ${required}`);
    }

    // Pi slash commands are sequential user actions. Wait for each response so
    // an async command never receives a stale command context from the next one.
    await rpc.request({ id: "doctor", type: "prompt", message: "/second-brain-doctor" }, 360_000);
    await rpc.request({ id: "status", type: "prompt", message: "/memory-status" });
    await rpc.request({ id: "refresh", type: "prompt", message: "/graph-refresh" }, 180_000);

    const notifications = rpc.events
      .filter((event) => event.type === "extension_ui_request" && event.method === "notify")
      .map((event) => String(event.message ?? ""));
    if (!notifications.some((entry) => /Second Brain: connected/.test(entry) && /source: bundled-uv/.test(entry))) {
      throw new Error(`Packed package did not connect through its bundled uv runtime. ${rpc.diagnostics()}`);
    }
    if (!notifications.some((entry) => /^Graph refreshed: \d+ nodes, \d+ edges/.test(entry))) {
      throw new Error(`Packed package did not refresh a real graph. ${rpc.diagnostics()}`);
    }
  } finally {
    await rpc.stop();
  }
  if (!existsSync(path.join(project, "graphify-out", "graph.json"))) {
    throw new Error("Packed package refresh did not write graphify-out/graph.json");
  }

  execFileSync(pi, ["remove", "-l", installedPackage, "--approve"], { cwd: project, env, stdio: "pipe" });
  const settings = JSON.parse(readFileSync(path.join(project, ".pi", "settings.json"), "utf8")) as { packages?: string[] };
  if ((settings.packages ?? []).length !== 0) throw new Error("Packed package remained enabled after removal");
  console.log(`Packed artifact verified end to end (${files.length} files): install, bundled runtime bootstrap, Pi load, graph refresh, skill discovery, and removal.`);
} finally {
  rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

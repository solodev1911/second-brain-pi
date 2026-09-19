import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, mkdir, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { afterEach, describe, expect, it } from "vitest";

type Event = Record<string, any>;
let child: ChildProcessWithoutNullStreams | undefined;

function rpcHarness(process: ChildProcessWithoutNullStreams) {
  const events: Event[] = [];
  const waiters: Array<{ predicate: (event: Event) => boolean; resolve: (event: Event) => void }> = [];
  readline.createInterface({ input: process.stdout }).on("line", (line) => {
    let event: Event;
    try { event = JSON.parse(line); } catch { return; }
    events.push(event);
    for (const waiter of [...waiters]) {
      if (!waiter.predicate(event)) continue;
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve(event);
    }
  });
  const send = (value: Event) => process.stdin.write(`${JSON.stringify(value)}\n`);
  const waitFor = (predicate: (event: Event) => boolean, timeout = 30_000): Promise<Event> => {
    const found = events.find(predicate);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve };
      waiters.push(waiter);
      const timer = setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        reject(new Error(`RPC timeout. Events: ${JSON.stringify(events.slice(-12))}`));
      }, timeout);
      waiter.resolve = (event) => { clearTimeout(timer); resolve(event); };
    });
  };
  return { events, send, waitFor };
}

afterEach(async () => {
  if (!child || child.exitCode !== null) return;
  child.stdin.end();
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => { child?.kill("SIGTERM"); resolve(); }, 5_000);
    child?.once("exit", () => { clearTimeout(timer); resolve(); });
  });
});

describe("Pi RPC end-to-end", () => {
  it("discovers commands, captures once, deduplicates, and emits an audit entry", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "second-brain-rpc-project-"));
    const configDir = await mkdtemp(path.join(os.tmpdir(), "second-brain-rpc-config-"));
    const sessions = path.join(root, "sessions");
    await mkdir(path.join(root, "src"));
    await mkdir(sessions);
    await writeFile(path.join(root, "src", "billing.py"), "def calculate_total(items):\n    return sum(x['price_cents'] for x in items)\n");
    const packageRoot = path.resolve(import.meta.dirname, "../..");
    const pi = process.env.SECOND_BRAIN_TEST_PI ?? (process.platform === "win32" ? "pi.cmd" : "pi");
    child = spawn(pi, [
      "--mode", "rpc", "--offline", "--approve", "--no-extensions", "--no-skills",
      "--extension", path.join(packageRoot, "tests", "fixtures", "fake-provider.ts"),
      "--extension", path.join(packageRoot, "extensions", "second-brain.ts"),
      "--provider", "second-brain-fake", "--model", "fixture", "--session-dir", sessions,
      "--second-brain-startup-refresh", "off",
    ], { cwd: root, env: { ...process.env, PI_CODING_AGENT_DIR: configDir, SECOND_BRAIN_STARTUP_REFRESH: "off" } });
    const stderr: string[] = [];
    child.stderr.on("data", (chunk) => stderr.push(String(chunk)));
    const rpc = rpcHarness(child);

    rpc.send({ id: "commands", type: "get_commands" });
    const commands = await rpc.waitFor((event) => event.type === "response" && event.id === "commands");
    expect(commands.success, stderr.join("")).toBe(true);
    expect(commands.data.commands.map((command: Event) => command.name)).toEqual(expect.arrayContaining([
      "remember", "memory-status", "second-brain-doctor", "graph-refresh",
    ]));

    rpc.send({ id: "question", type: "prompt", message: "Where is the invoice total calculated?" });
    await rpc.waitFor((event) => event.type === "response" && event.id === "question");
    await rpc.waitFor((event) => event.type === "agent_settled");

    rpc.send({ id: "capture-1", type: "prompt", message: "/remember" });
    const captured = await rpc.waitFor((event) => event.type === "response" && event.id === "capture-1", 240_000);
    expect(captured.success, stderr.join("")).toBe(true);
    await rpc.waitFor((event) => event.type === "extension_ui_request" && event.method === "notify" && /^Saved: graphify-out\/memory\//.test(event.message), 30_000);
    const memoryDir = path.join(root, "graphify-out", "memory");
    expect((await readdir(memoryDir)).filter((name) => name.endsWith(".md"))).toHaveLength(1);

    rpc.send({ id: "capture-2", type: "prompt", message: "/remember" });
    await rpc.waitFor((event) => event.type === "response" && event.id === "capture-2", 240_000);
    await rpc.waitFor((event) => event.type === "extension_ui_request" && event.method === "notify" && /^Already saved:/.test(event.message));
    expect((await readdir(memoryDir)).filter((name) => name.endsWith(".md"))).toHaveLength(1);

    rpc.send({ id: "entries", type: "get_entries" });
    const entries = await rpc.waitFor((event) => event.type === "response" && event.id === "entries");
    const captures = entries.data.entries.filter((entry: Event) => entry.type === "custom" && entry.customType === "second-brain.capture.v1");
    expect(captures).toHaveLength(2);
    expect(captures[0].data.refreshStatus).toBe("indexed");
  }, 300_000);
});

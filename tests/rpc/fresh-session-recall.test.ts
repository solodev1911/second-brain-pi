import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { afterEach, describe, expect, it } from "vitest";

type Event = Record<string, any>;
const children = new Set<ChildProcessWithoutNullStreams>();

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
        reject(new Error(`RPC timeout. Events: ${JSON.stringify(events.slice(-16))}`));
      }, timeout);
      waiter.resolve = (event) => { clearTimeout(timer); resolve(event); };
    });
  };
  return { events, send, waitFor };
}

async function stop(process: ChildProcessWithoutNullStreams): Promise<void> {
  children.delete(process);
  if (process.exitCode !== null) return;
  process.stdin.end();
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => { process.kill("SIGTERM"); resolve(); }, 5_000);
    process.once("exit", () => { clearTimeout(timer); resolve(); });
  });
}

afterEach(async () => {
  await Promise.all([...children].map(stop));
});

describe("fresh Pi session recall", () => {
  it("loads the installed package, captures in one process, and retrieves through Graphify in another", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "second-brain-fresh-session-"));
    const configDir = await mkdtemp(path.join(os.tmpdir(), "second-brain-fresh-config-"));
    const sessions = path.join(root, "sessions");
    await mkdir(path.join(root, "src"));
    await mkdir(sessions);
    await import("node:fs/promises").then(({ writeFile }) => writeFile(
      path.join(root, "src", "billing.py"),
      "def calculate_total(items):\n    return sum(x['price_cents'] for x in items)\n",
    ));

    const packageRoot = path.resolve(import.meta.dirname, "../..");
    const engineRoot = process.env.SECOND_BRAIN_TEST_GRAPHIFY_ROOT ?? path.join(packageRoot, "graphify");
    const python = process.env.SECOND_BRAIN_TEST_GRAPHIFY_PYTHON
      ?? path.join(engineRoot, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
    const pi = process.env.SECOND_BRAIN_TEST_PI ?? (process.platform === "win32" ? "pi.cmd" : "pi");
    const env = { ...process.env, PI_CODING_AGENT_DIR: configDir, SECOND_BRAIN_STARTUP_REFRESH: "off" };
    const installed = spawnSync(pi, ["install", "-l", packageRoot, "--approve"], { cwd: root, env, encoding: "utf8" });
    expect(installed.status, `${installed.stdout}\n${installed.stderr}`).toBe(0);

    const launch = () => {
      const child = spawn(pi, [
        "--mode", "rpc", "--offline", "--approve",
        "--extension", path.join(packageRoot, "tests", "fixtures", "recall-provider.ts"),
        "--provider", "second-brain-recall", "--model", "fixture", "--session-dir", sessions,
        "--second-brain-graphify-command", python, "--second-brain-graphify-engine-root", engineRoot,
        "--second-brain-startup-refresh", "off",
      ], { cwd: root, env });
      children.add(child);
      return child;
    };

    const first = launch();
    const firstErrors: string[] = [];
    first.stderr.on("data", (chunk) => firstErrors.push(String(chunk)));
    const rpc1 = rpcHarness(first);
    rpc1.send({ id: "commands", type: "get_commands" });
    const commands = await rpc1.waitFor((event) => event.type === "response" && event.id === "commands");
    expect(commands.success, firstErrors.join("")).toBe(true);
    expect(commands.data.commands.map((command: Event) => command.name)).toEqual(expect.arrayContaining([
      "remember", "memory-status", "graph-refresh", "skill:second-brain",
    ]));

    rpc1.send({ id: "question", type: "prompt", message: "Where is the invoice total calculated?" });
    await rpc1.waitFor((event) => event.type === "response" && event.id === "question");
    await rpc1.waitFor((event) => event.type === "agent_settled");
    rpc1.send({ id: "capture", type: "prompt", message: "/remember" });
    await rpc1.waitFor((event) => event.type === "response" && event.id === "capture", 240_000);
    await rpc1.waitFor((event) => event.type === "extension_ui_request" && event.method === "notify"
      && /^Saved: graphify-out\/memory\//.test(event.message), 30_000);
    await stop(first);

    const memories = (await readdir(path.join(root, "graphify-out", "memory"))).filter((name) => name.endsWith(".md"));
    expect(memories).toHaveLength(1);
    expect(await readFile(path.join(root, "graphify-out", "memory", memories[0]!), "utf8")).toContain("calculate_total");

    const second = launch();
    const secondErrors: string[] = [];
    second.stderr.on("data", (chunk) => secondErrors.push(String(chunk)));
    const rpc2 = rpcHarness(second);
    rpc2.send({ id: "recall", type: "prompt", message: "What was the saved billing conclusion?" });
    const recall = await rpc2.waitFor((event) => event.type === "response" && event.id === "recall", 120_000);
    expect(recall.success, secondErrors.join("")).toBe(true);
    await rpc2.waitFor((event) => event.type === "agent_settled");
    rpc2.send({ id: "entries", type: "get_entries" });
    const entriesResponse = await rpc2.waitFor((event) => event.type === "response" && event.id === "entries");
    const entries = entriesResponse.data.entries as Event[];
    const queryCallIndex = entries.findIndex((entry) => entry.type === "message" && entry.message?.role === "assistant"
      && entry.message.content?.some((part: Event) => part.type === "toolCall" && part.name === "query_graph"));
    const queryResultIndex = entries.findIndex((entry) => entry.type === "message" && entry.message?.role === "toolResult"
      && entry.message.toolName === "query_graph" && entry.message.isError === false);
    const finalIndex = entries.findIndex((entry) => entry.type === "message" && entry.message?.role === "assistant"
      && entry.message.content?.some((part: Event) => part.type === "text" && part.text.includes("RECALLED_FROM_GRAPH")));
    expect(queryCallIndex, secondErrors.join("")).toBeGreaterThan(-1);
    expect(queryResultIndex).toBeGreaterThan(queryCallIndex);
    expect(finalIndex).toBeGreaterThan(queryResultIndex);
    const queryResult = entries[queryResultIndex]!.message;
    expect(queryResult.details).toMatchObject({ kind: "second-brain.graphify", backendTool: "query_graph", success: true });
    expect(queryResult.content.map((part: Event) => part.text ?? "").join("\n")).toMatch(/calculate_total|Invoice totals are calculated/i);
    await stop(second);
  }, 360_000);
});

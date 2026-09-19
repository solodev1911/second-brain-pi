import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

type RpcEvent = Record<string, any>;
type PromptEvidence = {
  prompt: string;
  toolOrder: string[];
  memoryReturned: boolean;
  sourceVerified: boolean;
  expectedFactUsed: boolean;
};

const provider = process.env.SECOND_BRAIN_LIVE_PROVIDER?.trim();
const model = process.env.SECOND_BRAIN_LIVE_MODEL?.trim();
if (!provider || !model) {
  throw new Error("Real-model gate not configured. Set SECOND_BRAIN_LIVE_PROVIDER and SECOND_BRAIN_LIVE_MODEL to a provider/model already authenticated in Pi.");
}

const packageRoot = path.resolve(import.meta.dirname, "..");
const pi = process.env.SECOND_BRAIN_TEST_PI ?? (process.platform === "win32" ? "pi.cmd" : "pi");
const engineRoot = process.env.SECOND_BRAIN_TEST_GRAPHIFY_ROOT ?? path.join(packageRoot, "graphify");
const python = process.env.SECOND_BRAIN_TEST_GRAPHIFY_PYTHON
  ?? path.join(engineRoot, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const scratch = await mkdtemp(path.join(os.tmpdir(), "second-brain-live-acceptance-"));
const project = path.join(scratch, "project");
const sessions = path.join(scratch, "sessions");
const children = new Set<ChildProcessWithoutNullStreams>();

function rpcHarness(process: ChildProcessWithoutNullStreams) {
  const events: RpcEvent[] = [];
  const waiters: Array<{ after: number; predicate: (event: RpcEvent) => boolean; resolve: (event: RpcEvent) => void }> = [];
  readline.createInterface({ input: process.stdout }).on("line", (line) => {
    let event: RpcEvent;
    try { event = JSON.parse(line); } catch { return; }
    events.push(event);
    const index = events.length - 1;
    for (const waiter of [...waiters]) {
      if (index < waiter.after || !waiter.predicate(event)) continue;
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve(event);
    }
  });
  const send = (value: RpcEvent) => process.stdin.write(`${JSON.stringify(value)}\n`);
  const waitFor = (predicate: (event: RpcEvent) => boolean, timeout = 240_000, after = 0): Promise<RpcEvent> => {
    const found = events.slice(after).find(predicate);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const waiter = { after, predicate, resolve };
      waiters.push(waiter);
      const timer = setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        reject(new Error(`Pi RPC timeout; recent event types: ${events.slice(-20).map((event) => event.type).join(", ")}`));
      }, timeout);
      waiter.resolve = (event) => { clearTimeout(timer); resolve(event); };
    });
  };
  return { events, send, waitFor };
}

async function stop(child: ChildProcessWithoutNullStreams): Promise<void> {
  children.delete(child);
  if (child.exitCode !== null) return;
  child.stdin.end();
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => { child.kill("SIGTERM"); resolve(); }, 5_000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
  });
}

function start() {
  const child = spawn(pi, [
    "--mode", "rpc", "--approve", "--provider", provider!, "--model", model!, "--session-dir", sessions,
    "--second-brain-graphify-command", python, "--second-brain-graphify-engine-root", engineRoot,
    "--second-brain-startup-refresh", "off",
  ], { cwd: project, env: { ...process.env, SECOND_BRAIN_STARTUP_REFRESH: "off" } });
  const stderr: string[] = [];
  child.stderr.on("data", (chunk) => stderr.push(String(chunk)));
  children.add(child);
  return { child, rpc: rpcHarness(child), stderr };
}

async function ready(instance: ReturnType<typeof start>, id: string): Promise<void> {
  const after = instance.rpc.events.length;
  instance.rpc.send({ id, type: "get_commands" });
  const response = await instance.rpc.waitFor((event) => event.type === "response" && event.id === id, 30_000, after);
  if (!response.success) throw new Error(`Pi command discovery failed: ${JSON.stringify(response)}\n${instance.stderr.join("")}`);
  const names = new Set(response.data.commands.map((entry: { name: string }) => entry.name));
  for (const required of ["remember", "memory-status", "second-brain-doctor", "graph-refresh", "skill:second-brain"]) {
    if (!names.has(required)) throw new Error(`Installed package did not expose ${required}`);
  }
}

async function prompt(instance: ReturnType<typeof start>, id: string, message: string): Promise<void> {
  const after = instance.rpc.events.length;
  instance.rpc.send({ id, type: "prompt", message });
  const response = await instance.rpc.waitFor((event) => event.type === "response" && event.id === id, 240_000, after);
  if (!response.success) throw new Error(`Pi rejected ${id}: ${JSON.stringify(response)}\n${instance.stderr.join("")}`);
  await instance.rpc.waitFor((event) => event.type === "agent_settled", 240_000, after);
}

async function command(instance: ReturnType<typeof start>, id: string, message: string, notification: RegExp): Promise<string> {
  const after = instance.rpc.events.length;
  instance.rpc.send({ id, type: "prompt", message });
  const response = await instance.rpc.waitFor((event) => event.type === "response" && event.id === id, 240_000, after);
  if (!response.success) throw new Error(`Pi rejected ${message}: ${JSON.stringify(response)}\n${instance.stderr.join("")}`);
  const notice = await instance.rpc.waitFor(
    (event) => event.type === "extension_ui_request" && event.method === "notify" && notification.test(String(event.message)),
    240_000,
    after,
  );
  return String(notice.message);
}

async function entries(instance: ReturnType<typeof start>, id: string): Promise<RpcEvent[]> {
  const after = instance.rpc.events.length;
  instance.rpc.send({ id, type: "get_entries" });
  const response = await instance.rpc.waitFor((event) => event.type === "response" && event.id === id, 30_000, after);
  if (!response.success) throw new Error(`Could not read Pi entries: ${JSON.stringify(response)}`);
  return response.data.entries as RpcEvent[];
}

function contentText(message: RpcEvent): string {
  return (message.content ?? []).filter((part: RpcEvent) => part.type === "text").map((part: RpcEvent) => part.text).join("\n");
}

function inspectPrompt(history: RpcEvent[], promptText: string, expectedFact: string, sourceToken: string, expectMemory: boolean): PromptEvidence {
  const messages = history.filter((entry) => entry.type === "message").map((entry) => entry.message as RpcEvent);
  const calls = messages.flatMap((message, messageIndex) => (message.content ?? [])
    .filter((part: RpcEvent) => part.type === "toolCall")
    .map((part: RpcEvent) => ({ name: String(part.name), messageIndex })));
  const query = calls.find((call) => call.name === "query_graph");
  if (!query) throw new Error(`Related prompt did not call query_graph: ${promptText}`);
  const broad = calls.find((call) => ["read", "grep", "find", "ls", "bash"].includes(call.name));
  if (broad && broad.messageIndex < query.messageIndex) throw new Error(`Broad source tool preceded query_graph for: ${promptText}`);
  const queryResultIndex = messages.findIndex((message) => message.role === "toolResult" && message.toolName === "query_graph" && message.isError === false);
  if (queryResultIndex < 0) throw new Error(`query_graph did not return successfully for: ${promptText}`);
  const queryText = contentText(messages[queryResultIndex]!);
  const memoryReturned = /graphify-out\/memory\//.test(queryText);
  if (expectMemory && !memoryReturned) throw new Error(`Graph query did not return a stored memory for: ${promptText}`);
  const sourceVerified = messages.slice(queryResultIndex + 1).some((message) =>
    message.role === "toolResult" && ["read", "bash"].includes(String(message.toolName)) && contentText(message).includes(sourceToken));
  if (!sourceVerified) throw new Error(`Current source was not inspected after graph retrieval for: ${promptText}`);
  const final = [...messages].reverse().find((message) => message.role === "assistant" && message.stopReason === "stop");
  const expectedFactUsed = Boolean(final && contentText(final).includes(expectedFact));
  if (!expectedFactUsed) throw new Error(`Final answer omitted expected fact ${expectedFact} for: ${promptText}`);
  return { prompt: promptText, toolOrder: calls.map((call) => call.name), memoryReturned, sourceVerified, expectedFactUsed };
}

async function freshPrompt(id: string, promptText: string, expectedFact: string, sourceToken: string): Promise<PromptEvidence> {
  const instance = start();
  try {
    await ready(instance, `${id}-ready`);
    await prompt(instance, id, promptText);
    return inspectPrompt(await entries(instance, `${id}-entries`), promptText, expectedFact, sourceToken, true);
  } finally {
    await stop(instance.child);
  }
}

try {
  const auth = spawnSync(pi, ["auth", "check", "--provider", provider, "--model", model, "--json", "--no-refresh"], {
    encoding: "utf8",
    env: process.env,
  });
  if (auth.status !== 0) throw new Error(`Pi provider is not ready for ${provider}/${model}. Configure it with pi, then rerun test:live. ${auth.stdout || auth.stderr}`);
  const authStatus = JSON.parse(auth.stdout) as { status?: string };
  if (authStatus.status !== "ready") throw new Error(`Pi provider is not ready for ${provider}/${model}.`);

  await mkdir(path.join(project, "src"), { recursive: true });
  await mkdir(sessions, { recursive: true });
  await writeFile(path.join(project, "src", "billing.py"), [
    "def calculate_total(items):",
    "    return sum(item['price_cents'] for item in items)",
    "",
    "def create_invoice(items):",
    "    return {'total_cents': calculate_total(items)}",
    "",
  ].join("\n"));
  await writeFile(path.join(project, "src", "tax.py"), [
    "def apply_tax(total_cents, tax_basis_points):",
    "    return total_cents + (total_cents * tax_basis_points // 10_000)",
    "",
  ].join("\n"));
  await writeFile(path.join(project, "src", "storage.py"), [
    "import json",
    "",
    "def save_invoice(invoice, destination):",
    "    destination.write_text(json.dumps(invoice, sort_keys=True))",
    "",
  ].join("\n"));

  const installed = spawnSync(pi, ["install", "-l", packageRoot, "--approve"], { cwd: project, encoding: "utf8", env: process.env });
  if (installed.status !== 0) throw new Error(`Could not install package in live fixture: ${installed.stdout}\n${installed.stderr}`);

  const captureSession = start();
  const captured: string[] = [];
  try {
    await ready(captureSession, "capture-ready");
    await command(captureSession, "refresh-initial", "/graph-refresh", /Graph refreshed:/);
    const seedPrompts = [
      "Where is the invoice total calculated? Verify the current source.",
      "Where is sales tax added and how is the rate represented? Verify the current source.",
      "How are invoices persisted? Verify the current source.",
    ];
    for (const [index, seed] of seedPrompts.entries()) {
      await prompt(captureSession, `seed-${index}`, seed);
      const notice = await command(captureSession, `remember-${index}`, "/remember", /^(Saved|Already saved): graphify-out\/memory\//);
      const match = /graphify-out\/memory\/[^\s)]+\.md/.exec(notice);
      if (!match) throw new Error(`Capture notification omitted memory path: ${notice}`);
      captured.push(match[0]);
    }
  } finally {
    await stop(captureSession.child);
  }
  const memoryDir = path.join(project, "graphify-out", "memory");
  const beforeCorrection = (await readdir(memoryDir)).filter((name) => name.endsWith(".md"));
  if (beforeCorrection.length < 3) throw new Error(`Expected three stored explanations, found ${beforeCorrection.length}`);

  const evidence: PromptEvidence[] = [];
  evidence.push(await freshPrompt("fresh-invoice", "Which routine adds up the amounts on an invoice?", "calculate_total", "price_cents"));
  evidence.push(await freshPrompt("fresh-caller", "What calls the routine that totals an invoice?", "create_invoice", "create_invoice"));
  evidence.push(await freshPrompt("fresh-tax", "Which code applies sales tax using basis points?", "apply_tax", "tax_basis_points"));
  evidence.push(await freshPrompt("fresh-storage", "Where is invoice JSON written to disk?", "save_invoice", "write_text"));

  const unrelated = start();
  try {
    await ready(unrelated, "unrelated-ready");
    const generic = "What is the capital of France? Answer without inspecting this repository.";
    await prompt(unrelated, "fresh-unrelated", generic);
    const history = await entries(unrelated, "fresh-unrelated-entries");
    const graphCall = history.some((entry) => entry.type === "message" && entry.message?.role === "assistant"
      && entry.message.content?.some((part: RpcEvent) => part.type === "toolCall" && String(part.name).includes("graph")));
    if (graphCall) throw new Error("Unrelated prompt unnecessarily invoked a graph tool");
    evidence.push({ prompt: generic, toolOrder: [], memoryReturned: false, sourceVerified: false, expectedFactUsed: true });
  } finally {
    await stop(unrelated.child);
  }

  await writeFile(path.join(project, "src", "billing.py"), [
    "def calculate_total(items, service_fee_cents=0):",
    "    return sum(item['price_cents'] for item in items) + service_fee_cents",
    "",
    "def create_invoice(items, service_fee_cents=0):",
    "    return {'total_cents': calculate_total(items, service_fee_cents)}",
    "",
  ].join("\n"));
  const correction = start();
  try {
    await ready(correction, "correction-ready");
    await command(correction, "refresh-correction", "/graph-refresh", /Graph refreshed:/);
    const correctionPrompt = "How is the invoice total calculated now? Compare any saved conclusion with current source and identify what changed.";
    await prompt(correction, "stale-check", correctionPrompt);
    const correctionHistory = await entries(correction, "stale-check-entries");
    evidence.push(inspectPrompt(correctionHistory, correctionPrompt, "service_fee_cents", "service_fee_cents", true));
    await command(correction, "remember-correction", "/remember", /^Saved: graphify-out\/memory\//);
  } finally {
    await stop(correction.child);
  }
  const afterCorrection = (await readdir(memoryDir)).filter((name) => name.endsWith(".md"));
  if (afterCorrection.length <= beforeCorrection.length) throw new Error("Corrected conclusion was incorrectly deduplicated");
  const correctedDocs = await Promise.all(afterCorrection.map((name) => readFile(path.join(memoryDir, name), "utf8")));
  if (!correctedDocs.some((doc) => doc.includes("service_fee_cents"))) throw new Error("Corrected memory does not contain the changed source fact");

  console.log(JSON.stringify({
    ok: true,
    provider,
    model,
    platform: `${process.platform}/${process.arch}`,
    captured,
    memoryCount: afterCorrection.length,
    prompts: evidence,
  }, null, 2));
} finally {
  await Promise.all([...children].map(stop));
  await rm(scratch, { recursive: true, force: true });
}

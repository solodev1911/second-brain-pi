import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CONNECTION_TIMEOUT_MS, READ_TIMEOUT_MS, RETAINED_STDERR_BYTES } from "./constants.js";
import type { EngineConfig, TextToolResult } from "./types.js";
import { SecondBrainError } from "./types.js";

export class GraphifyClient {
  private client?: Client;
  private transport?: StdioClientTransport;
  private connecting?: Promise<Set<string>>;
  private stderr = "";

  constructor(private readonly config: EngineConfig) {}

  diagnostics(): string {
    return this.stderr;
  }

  async connect(signal?: AbortSignal): Promise<Set<string>> {
    this.connecting ??= this.open(signal).catch((error) => {
      this.connecting = undefined;
      throw error;
    });
    return this.connecting;
  }

  private async open(signal?: AbortSignal): Promise<Set<string>> {
    const transport = new StdioClientTransport({
      command: this.config.command,
      args: this.config.args,
      ...(this.config.cwd ? { cwd: this.config.cwd } : {}),
      env: { ...getDefaultEnvironment(), ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")) },
      stderr: "pipe",
    });
    transport.stderr?.on("data", (chunk: Buffer | string) => {
      this.stderr = `${this.stderr}${String(chunk)}`.slice(-RETAINED_STDERR_BYTES);
    });
    const client = new Client({ name: "second-brain", version: "0.1.0-beta.1" });
    try {
      const connectionTimeout = this.config.connectionTimeoutMs ?? CONNECTION_TIMEOUT_MS;
      await client.connect(transport, { signal, timeout: connectionTimeout });
      const listed = await client.listTools({}, { signal, timeout: connectionTimeout });
      this.transport = transport;
      this.client = client;
      return new Set(listed.tools.map((tool) => tool.name));
    } catch (error) {
      await transport.close().catch(() => undefined);
      throw new SecondBrainError("MCP_CONNECT_FAILED", `Could not connect to Graphify: ${(error as Error).message}`, { cause: error });
    }
  }

  async call(name: string, args: Record<string, unknown>, options: { signal?: AbortSignal; timeout?: number } = {}): Promise<TextToolResult> {
    await this.connect(options.signal);
    if (!this.client) throw new SecondBrainError("MCP_NOT_CONNECTED", "Graphify client is not connected.");
    const result = await this.client.callTool(
      { name, arguments: args },
      undefined,
      { signal: options.signal, timeout: options.timeout ?? READ_TIMEOUT_MS, maxTotalTimeout: options.timeout ?? READ_TIMEOUT_MS },
    );
    const content = (result as { content?: unknown[] }).content ?? [];
    const text = content
      .filter((entry): entry is { type: "text"; text: string } => Boolean(entry && typeof entry === "object" && (entry as { type?: unknown }).type === "text" && typeof (entry as { text?: unknown }).text === "string"))
      .map((entry) => entry.text)
      .join("\n");
    return { text, isError: result.isError === true };
  }

  async close(): Promise<void> {
    const transport = this.transport;
    this.client = undefined;
    this.transport = undefined;
    this.connecting = undefined;
    if (transport) await transport.close();
  }

  pid(): number | null {
    return this.transport?.pid ?? null;
  }
}

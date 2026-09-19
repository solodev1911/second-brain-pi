import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { doctorReport } from "../../src/doctor.js";
import type { GraphifyService } from "../../src/graphify-service.js";
import type { ResolvedConfig } from "../../src/types.js";

async function bundledFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "second-brain-doctor-engine-"));
  await mkdir(path.join(root, "graphify"));
  await writeFile(path.join(root, "pyproject.toml"), "[project]\nname = 'fixture'\n");
  await writeFile(path.join(root, "uv.lock"), "version = 1\n");
  await writeFile(path.join(root, "graphify", "serve.py"), "");
  return root;
}

describe("Second Brain doctor", () => {
  it("reports a ready uv-managed installation", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "second-brain-doctor-project-"));
    const bundledEngineRoot = await bundledFixture();
    const bin = await mkdtemp(path.join(os.tmpdir(), "second-brain-doctor-bin-"));
    const uv = path.join(bin, process.platform === "win32" ? "uv.exe" : "uv");
    await writeFile(uv, "");
    if (process.platform !== "win32") await chmod(uv, 0o755);
    const config: ResolvedConfig = {
      engine: {
        command: "uv",
        args: [],
        cwd: bundledEngineRoot,
        source: "bundled-uv",
      },
      startupRefresh: "off",
    };
    const service = {
      isUsable: () => true,
      supportedTools: () => ["query_graph", "refresh_graph"],
    } as unknown as GraphifyService;

    const report = await doctorReport({
      projectRoot,
      bundledEngineRoot,
      config,
      service,
      collisions: [],
      environment: { PATH: bin },
    });

    expect(report).toContain("[PASS] Bundled Graphify");
    expect(report).toContain(`[PASS] Runtime command: ${uv}`);
    expect(report).toContain("[PASS] Graphify MCP: connected (2 graph tool(s))");
    expect(report).toContain("Result: READY WITH 1 WARNING");
  });

  it("gives actionable failures when uv and project trust are unavailable", async () => {
    const bundledEngineRoot = await bundledFixture();
    const config: ResolvedConfig = {
      engine: { command: "uv", args: [], source: "bundled-uv" },
      startupRefresh: "off",
    };

    const report = await doctorReport({
      bundledEngineRoot,
      config,
      collisions: ["query_graph"],
      error: "spawn uv ENOENT",
      environment: { PATH: "" },
    });

    expect(report).toContain("[FAIL] Project: not available or not trusted");
    expect(report).toContain("Install uv from https://docs.astral.sh/uv/getting-started/installation/");
    expect(report).toContain("[FAIL] Pi tools: required name collision: query_graph");
    expect(report).toContain("[FAIL] Last runtime error: spawn uv ENOENT");
    expect(report).toMatch(/Result: NOT READY \(\d+ FAILURES\)/);
  });
});

import { mkdtemp, mkdir, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "../../src/config.js";
import { assertContainedExistingAncestor, resolveProjectRoot } from "../../src/project-root.js";

describe("trusted project resolution", () => {
  it("selects the nearest graph owner and confines explicit roots", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "second-brain-root-"));
    const nested = path.join(root, "src", "nested");
    await mkdir(path.join(root, "graphify-out"), { recursive: true });
    await mkdir(nested, { recursive: true });
    await writeFile(path.join(root, "graphify-out", "graph.json"), "{}");
    expect(resolveProjectRoot({ cwd: nested, trusted: true })).toBe(await realpath(root));
    expect(() => resolveProjectRoot({ cwd: nested, trusted: false })).toThrow(/disabled until Pi trusts/i);
    const outside = await mkdtemp(path.join(os.tmpdir(), "second-brain-outside-"));
    expect(() => resolveProjectRoot({ cwd: nested, trusted: true, explicitRoot: outside })).toThrow(/not an ancestor/i);
  });

  it("rejects a symlink escape beneath the project", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "second-brain-link-root-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "second-brain-link-out-"));
    await import("node:fs/promises").then((fs) => fs.symlink(outside, path.join(root, "graphify-out")));
    expect(() => assertContainedExistingAncestor(root, path.join(root, "graphify-out", "memory"))).toThrow(/resolves outside/i);
  });
});

describe("configuration precedence", () => {
  it("uses a root Python profile without appending args to graphify-mcp", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "second-brain-config-"));
    const engine = await mkdtemp(path.join(os.tmpdir(), "second-brain-engine-"));
    const python = path.join(engine, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
    await mkdir(path.dirname(python), { recursive: true });
    await writeFile(python, "");
    expect(resolveConfig({ projectRoot: root, flagEngineRoot: engine }).engine).toMatchObject({ command: python, args: ["-m", "graphify.serve"], source: "flags" });
    expect(resolveConfig({ projectRoot: root, flagCommand: "graphify-mcp", flagEngineRoot: engine }).engine.args).toEqual([]);
  });

  it("allows only project config to supply arbitrary argument arrays", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "second-brain-project-config-"));
    await mkdir(path.join(root, ".pi"));
    await writeFile(path.join(root, ".pi", "second-brain.json"), JSON.stringify({
      schemaVersion: 1,
      graphify: { command: "/trusted/python", args: ["-m", "graphify.serve"] },
      startupRefresh: "off",
    }));
    const resolved = resolveConfig({ projectRoot: root, environment: {} });
    expect(resolved.engine.args).toEqual(["-m", "graphify.serve"]);
    expect(resolved.startupRefresh).toBe("off");
  });

  it("honors startup environment unless an explicit flag overrides it", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "second-brain-startup-config-"));
    expect(resolveConfig({ projectRoot: root, environment: { SECOND_BRAIN_STARTUP_REFRESH: "off" } }).startupRefresh).toBe("off");
    expect(resolveConfig({ projectRoot: root, flagStartupRefresh: "background", environment: { SECOND_BRAIN_STARTUP_REFRESH: "off" } }).startupRefresh).toBe("background");
  });

  it("discovers the package-bundled Graphify runtime before falling back to PATH", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "second-brain-bundled-project-"));
    const engineRoot = await mkdtemp(path.join(os.tmpdir(), "second-brain-bundled-engine-"));
    const python = path.join(engineRoot, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
    await mkdir(path.dirname(python), { recursive: true });
    await writeFile(python, "");

    expect(resolveConfig({ projectRoot: root, bundledEngineRoot: engineRoot, environment: {} }).engine).toEqual({
      command: python,
      args: ["-m", "graphify.serve"],
      cwd: engineRoot,
      source: "bundled",
    });

    const missingRoot = path.join(engineRoot, "missing");
    expect(resolveConfig({ projectRoot: root, bundledEngineRoot: missingRoot, environment: {} }).engine).toEqual({
      command: "graphify-mcp",
      args: [],
      source: "path",
    });
  });

  it("keeps explicit environment configuration ahead of the bundled runtime", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "second-brain-bundled-precedence-project-"));
    const bundledRoot = await mkdtemp(path.join(os.tmpdir(), "second-brain-bundled-precedence-engine-"));
    const bundledPython = path.join(bundledRoot, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
    await mkdir(path.dirname(bundledPython), { recursive: true });
    await writeFile(bundledPython, "");

    expect(resolveConfig({
      projectRoot: root,
      bundledEngineRoot: bundledRoot,
      environment: { SECOND_BRAIN_GRAPHIFY_COMMAND: "/custom/graphify-mcp" },
    }).engine).toEqual({ command: "/custom/graphify-mcp", args: [], source: "environment" });
  });
});

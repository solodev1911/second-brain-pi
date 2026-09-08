from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from graphify import memory_links
from graphify import serve as serve_mod


def _project_graph(project: Path) -> Path:
    output = project / "graphify-out"
    output.mkdir(parents=True)
    (output / "graph.html").write_text("<!doctype html>\n", encoding="utf-8")
    graph_path = output / "graph.json"
    graph_path.write_text(json.dumps({
        "directed": True,
        "nodes": [
            {"id": "source", "label": "Source"},
            {"id": "memory_note", "label": "Note", "kind": "memory"},
        ],
        "edges": [
            {"source": "memory_note", "target": "source", "relation": "memory"},
        ],
    }), encoding="utf-8")
    return graph_path


def test_refresh_uses_trusted_engine_cwd_and_only_inspects_cli_result(tmp_path, monkeypatch):
    project = tmp_path / "project"
    graph_path = _project_graph(project)
    shadow = project / "graphify"
    shadow.mkdir()
    (shadow / "__init__.py").write_text("", encoding="utf-8")
    (shadow / "__main__.py").write_text("raise RuntimeError('shadowed')\n", encoding="utf-8")
    monkeypatch.chdir(project)
    calls = []

    class Process:
        returncode = 0

        async def communicate(self):
            return b"Code graph updated.\n", b""

    async def create_subprocess_exec(*args, **kwargs):
        calls.append((args, kwargs))
        return Process()

    monkeypatch.setattr(serve_mod.asyncio, "create_subprocess_exec", create_subprocess_exec)

    def redundant_link(_root):
        raise AssertionError("refresh_graph must not link memories a second time")

    monkeypatch.setattr(memory_links, "link_project_memories", redundant_link)
    payload = json.loads(asyncio.run(serve_mod._tool_refresh_graph(project)))

    assert payload == {
        "ok": True,
        "memoryNodes": 1,
        "memoryEdges": 1,
        "nodes": 2,
        "edges": 1,
        "projectPath": str(project.resolve()),
        "graphPath": str(graph_path.resolve()),
        "htmlPath": str((project / "graphify-out" / "graph.html").resolve()),
    }
    assert len(calls) == 1
    args, kwargs = calls[0]
    assert args == (serve_mod.sys.executable, "-m", "graphify", "update", str(project.resolve()))
    assert kwargs["cwd"] == str(Path(serve_mod.__file__).resolve().parents[1])
    assert Path(kwargs["cwd"]).resolve() != project.resolve()
    assert kwargs["env"]["GRAPHIFY_NO_TIPS"] == "1"


def test_refresh_reports_spawn_failure(tmp_path, monkeypatch):
    project = tmp_path / "project"
    project.mkdir()

    async def create_subprocess_exec(*_args, **_kwargs):
        raise OSError("cannot spawn")

    monkeypatch.setattr(serve_mod.asyncio, "create_subprocess_exec", create_subprocess_exec)
    payload = json.loads(asyncio.run(serve_mod._tool_refresh_graph(project)))

    assert payload == {"ok": False, "error": "could not start graphify update: cannot spawn"}


def test_refresh_cancellation_terminates_child_and_reraises(tmp_path, monkeypatch):
    project = tmp_path / "project"
    project.mkdir()

    class Process:
        returncode = None
        terminated = False
        waited = False

        async def communicate(self):
            raise asyncio.CancelledError

        def terminate(self):
            self.terminated = True

        async def wait(self):
            self.waited = True

    process = Process()

    async def create_subprocess_exec(*_args, **_kwargs):
        return process

    monkeypatch.setattr(serve_mod.asyncio, "create_subprocess_exec", create_subprocess_exec)
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(serve_mod._tool_refresh_graph(project))

    assert process.terminated
    assert process.waited

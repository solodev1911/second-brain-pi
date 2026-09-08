import json
import sys
from pathlib import Path

from graphify import memory_links
from graphify import cli as cli_mod
from graphify import watch as watch_mod
from graphify.memory_links import link_project_memories, project_memory_stats
from graphify.reflect import parse_memory_doc


def _write_fixture(root: Path, output: Path | None = None) -> None:
    output = output or root / "graphify-out"
    memory = output / "memory"
    memory.mkdir(parents=True)
    (output / "graph.json").write_text(json.dumps({
        "directed": True,
        "multigraph": False,
        "graph": {},
        "nodes": [
            {"id": "calculate_total", "label": "calculate_total", "source_file": "src/billing.py", "source_location": "L3"},
            {"id": "duplicate_a", "label": "duplicate", "source_file": "a.py"},
            {"id": "duplicate_b", "label": "duplicate", "source_file": "b.py"},
        ],
        "links": [],
    }), encoding="utf-8")
    (memory / "query.md").write_text(
        "---\n"
        'type: "query"\n'
        'date: "2026-09-07T00:00:00.000Z"\n'
        'question: "Where is the total calculated?"\n'
        'summary: "Billing total location"\n'
        'contributor: "pi"\n'
        'source_nodes: ["calculate_total", "duplicate", "missing"]\n'
        "---\n\n# Q: Where is the total calculated?\n\n## Answer\n\nIn billing.\n",
        encoding="utf-8",
    )


def test_parse_memory_doc_includes_summary():
    parsed = parse_memory_doc('---\ntype: "query"\nsummary: "Hello"\n---\n')
    assert parsed is not None
    assert parsed["summary"] == "Hello"


def test_link_project_memories_is_idempotent_and_drops_ambiguous_sources(tmp_path):
    _write_fixture(tmp_path)
    first = link_project_memories(tmp_path)
    graph_path = tmp_path / "graphify-out" / "graph.json"
    first_bytes = graph_path.read_bytes()
    second = link_project_memories(tmp_path)
    assert graph_path.read_bytes() == first_bytes
    assert first == second
    assert first["memoryNodes"] == 1
    assert first["memoryEdges"] == 1
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    memory_nodes = [node for node in graph["nodes"] if node.get("metadata", {}).get("kind") == "memory"]
    assert len(memory_nodes) == 1
    assert memory_nodes[0]["question"] == "Where is the total calculated?"
    assert memory_nodes[0]["summary"] == "Billing total location"
    assert graph["links"][-1]["target"] == "calculate_total"


def test_deleted_memory_removes_derived_node_and_edge(tmp_path):
    _write_fixture(tmp_path)
    link_project_memories(tmp_path)
    (tmp_path / "graphify-out" / "memory" / "query.md").unlink()
    result = link_project_memories(tmp_path)
    assert result["memoryNodes"] == 0
    assert result["memoryEdges"] == 0


def test_absolute_output_uses_safe_output_relative_memory_identity(tmp_path, monkeypatch):
    root = tmp_path / "project"
    root.mkdir()
    output = tmp_path / "shared" / "custom-graphify-out"
    _write_fixture(root, output)
    monkeypatch.setattr(memory_links, "GRAPHIFY_OUT", str(output))

    result = link_project_memories(root)

    graph = json.loads((output / "graph.json").read_text(encoding="utf-8"))
    memory_node = next(node for node in graph["nodes"] if node.get("kind") == "memory")
    assert result["memoryNodes"] == 1
    assert memory_node["source_file"] == "custom-graphify-out/memory/query.md"
    assert memory_node["metadata"]["source_file"] == memory_node["source_file"]
    assert not Path(memory_node["source_file"]).is_absolute()
    assert "shared" not in Path(memory_node["source_file"]).parts


def test_project_memory_stats_is_read_only_and_preserves_refresh_payload(tmp_path):
    _write_fixture(tmp_path)
    linked = link_project_memories(tmp_path)
    graph_path = tmp_path / "graphify-out" / "graph.json"
    before = graph_path.read_bytes()

    inspected = project_memory_stats(tmp_path)

    assert graph_path.read_bytes() == before
    assert inspected == linked


def test_update_cli_owns_exactly_one_memory_link_pass(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(watch_mod, "_rebuild_code", lambda *_args, **_kwargs: True)
    monkeypatch.setattr(memory_links, "link_project_memories", lambda root: calls.append(root))
    monkeypatch.setattr(sys, "argv", ["graphify", "update", str(tmp_path)])
    monkeypatch.setenv("GRAPHIFY_NO_TIPS", "1")

    cli_mod.dispatch_command("update")

    assert calls == [tmp_path]

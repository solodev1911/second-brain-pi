"""Index explicit Second Brain query memories into an existing Graphify node-link graph."""
from __future__ import annotations

import json
import unicodedata
from pathlib import Path
from typing import Any

from graphify.ids import make_id
from graphify.paths import GRAPHIFY_OUT, write_json_atomic
from graphify.reflect import parse_memory_doc
from graphify.security import check_graph_file_size_cap


def _normalized_source(value: Any) -> str:
    return str(value or "").replace("\\", "/").removeprefix("./")


def _project_output(project_root: Path) -> Path:
    """Return the configured output directory for *project_root*."""
    configured = Path(GRAPHIFY_OUT)
    return configured.resolve() if configured.is_absolute() else (project_root / configured).resolve()


def _memory_source_file(memory_file: Path, project_root: Path, output: Path) -> str:
    """Return a stable, non-absolute source identity for a memory record.

    Normal project-local outputs retain their repository-relative path.  An
    absolute ``GRAPHIFY_OUT`` may live outside the project, so represent those
    records relative to the configured output directory and prefix its basename
    instead of leaking a host path into the graph or calling ``relative_to`` on
    unrelated paths.
    """
    try:
        return memory_file.relative_to(project_root).as_posix()
    except ValueError:
        within_output = memory_file.relative_to(output)
        output_name = output.name or "graphify-out"
        return (Path(output_name) / within_output).as_posix()


def _norm_label(value: Any) -> str:
    return "".join(
        char for char in unicodedata.normalize("NFKD", str(value or ""))
        if not unicodedata.combining(char)
    ).casefold()


def _is_memory_node(node: dict[str, Any]) -> bool:
    metadata = node.get("metadata") if isinstance(node.get("metadata"), dict) else {}
    return metadata.get("kind") == "memory" or node.get("kind") == "memory" \
        or _normalized_source(node.get("source_file")).startswith("graphify-out/memory/")


def _endpoint(link: dict[str, Any], key: str) -> str:
    value = link.get(key)
    return str(value.get("id", "")) if isinstance(value, dict) else str(value or "")


def _resolve_source(candidate: str, nodes: list[dict[str, Any]]) -> str | None:
    raw = candidate.strip()
    if not raw:
        return None
    exact = [node for node in nodes if str(node.get("id", "")) == raw]
    if len(exact) == 1:
        return str(exact[0]["id"])
    checks = (
        lambda node: str(node.get("label", "")) == raw,
        lambda node: _normalized_source(node.get("source_file")) == _normalized_source(raw),
        lambda node: str(node.get("label", "")).removeprefix(".").removesuffix("()")
        == raw.removeprefix(".").removesuffix("()"),
    )
    for check in checks:
        matches = [node for node in nodes if check(node)]
        if len(matches) == 1:
            return str(matches[0]["id"])
    return None


def link_memory_records(data: dict[str, Any], project_root: Path) -> dict[str, int]:
    """Replace the derived memory-node layer in *data*, in place, idempotently."""
    project_root = Path(project_root).resolve()
    output = _project_output(project_root)
    memory_dir = output / "memory"
    raw_nodes = data.get("nodes")
    if not isinstance(raw_nodes, list):
        raise ValueError("graph.json has no nodes array")
    edge_key = "links" if isinstance(data.get("links"), list) else "edges"
    raw_links = data.get(edge_key)
    if not isinstance(raw_links, list):
        raise ValueError("graph.json has no links or edges array")

    structural_nodes = [node for node in raw_nodes if isinstance(node, dict) and not _is_memory_node(node)]
    structural_ids = {str(node.get("id", "")) for node in structural_nodes}
    links = [
        link for link in raw_links
        if isinstance(link, dict)
        and _endpoint(link, "source") in structural_ids
        and _endpoint(link, "target") in structural_ids
        and link.get("relation") != "memory"
    ]
    memory_nodes: list[dict[str, Any]] = []
    memory_links: list[dict[str, Any]] = []

    for memory_file in sorted(memory_dir.glob("*.md")) if memory_dir.is_dir() else []:
        try:
            parsed = parse_memory_doc(memory_file.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError):
            continue
        if not parsed or parsed.get("type") != "query":
            continue
        question = str(parsed.get("question") or "").strip()
        summary = str(parsed.get("summary") or question).strip()
        if not question or not summary:
            continue
        relative = _memory_source_file(memory_file, project_root, output)
        memory_id = make_id("memory", relative)
        metadata = {
            "kind": "memory",
            "source_file": relative,
            "question": question,
            "summary": summary,
            "contributor": str(parsed.get("contributor") or ""),
        }
        memory_nodes.append({
            "id": memory_id,
            "label": summary,
            "norm_label": _norm_label(f"{question} {summary}"),
            "kind": "memory",
            "source_file": relative,
            "source_location": "",
            "question": question,
            "summary": summary,
            "contributor": metadata["contributor"],
            "metadata": metadata,
            "community": None,
        })
        resolved: list[str] = []
        for raw in parsed.get("source_nodes", []):
            source_id = _resolve_source(str(raw), structural_nodes)
            if source_id and source_id not in resolved:
                resolved.append(source_id)
        for source_id in resolved[:10]:
            memory_links.append({
                "source": memory_id,
                "target": source_id,
                "relation": "memory",
                "confidence": "EXTRACTED",
                "confidence_score": 1.0,
            })

    data["nodes"] = structural_nodes + memory_nodes
    data[edge_key] = links + memory_links
    return {
        "memoryNodes": len(memory_nodes),
        "memoryEdges": len(memory_links),
        "nodes": len(data["nodes"]),
        "edges": len(data[edge_key]),
    }


def link_project_memories(project_root: str | Path) -> dict[str, Any]:
    root = Path(project_root).resolve()
    output = _project_output(root)
    graph_path = output / "graph.json"
    check_graph_file_size_cap(graph_path)
    data = json.loads(graph_path.read_text(encoding="utf-8"))
    stats = link_memory_records(data, root)
    write_json_atomic(graph_path, data, indent=2, ensure_ascii=False)
    return {**stats, "projectPath": str(root), "graphPath": str(graph_path.resolve()), "htmlPath": str((output / "graph.html").resolve())}


def project_memory_stats(project_root: str | Path) -> dict[str, Any]:
    """Inspect a rebuilt project graph without rewriting it.

    ``graphify update`` already invokes :func:`link_project_memories`.  The MCP
    refresh tool uses this helper after that subprocess exits so it can preserve
    its response payload without redundantly linking and rewriting the graph.
    """
    root = Path(project_root).resolve()
    output = _project_output(root)
    graph_path = output / "graph.json"
    check_graph_file_size_cap(graph_path)
    data = json.loads(graph_path.read_text(encoding="utf-8"))
    nodes = data.get("nodes")
    if not isinstance(nodes, list):
        raise ValueError("graph.json has no nodes array")
    edge_key = "links" if isinstance(data.get("links"), list) else "edges"
    links = data.get(edge_key)
    if not isinstance(links, list):
        raise ValueError("graph.json has no links or edges array")
    return {
        "memoryNodes": sum(isinstance(node, dict) and _is_memory_node(node) for node in nodes),
        "memoryEdges": sum(isinstance(link, dict) and link.get("relation") == "memory" for link in links),
        "nodes": len(nodes),
        "edges": len(links),
        "projectPath": str(root),
        "graphPath": str(graph_path.resolve()),
        "htmlPath": str((output / "graph.html").resolve()),
    }


__all__ = ["link_memory_records", "link_project_memories", "project_memory_stats"]

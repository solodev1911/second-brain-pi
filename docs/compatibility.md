# Compatibility

## Supported baseline

| Component | Supported baseline | Notes |
|---|---|---|
| Pi | `0.85.1` or newer | Pi package loading, lifecycle events, RPC, and nested completion APIs are compatibility-sensitive. |
| Node.js | `22.19` or newer | Required by the npm package. |
| `uv` | Current stable release | Must be available on `PATH`; it provisions the locked Python environment. |
| Python | `3.10` or newer | Selected and managed by `uv`; a separate manual install is normally unnecessary. |
| Graphify | Bundled, patched `0.9.64` runtime | Do not install Graphify separately for the default configuration. |

Second Brain pins its direct MCP dependency and Graphify lockfile to make clean installations reproducible. The package uses `uv run --frozen`, so dependency drift fails rather than silently changing the runtime.

## Platforms

| Platform | Status |
|---|---|
| macOS arm64 | Verified for installation, graph refresh, capture, and fresh-session recall. |
| Linux x64 | Covered by automated package and test gates; beta feedback is welcome. |
| Windows | Experimental and not part of the stable support promise yet. |

Check the current workflow results before relying on a platform for production work. Include your OS, architecture, Node, Pi, and `uv` versions in compatibility reports.

## Content types

Graphify extracts relationships from many common programming languages and text formats. The bundled default runtime focuses on source-code graphing and does not install every optional Graphify media, database, or office-document extra.

Known limitations:

- Jupyter notebooks are not yet indexed with notebook-aware cell semantics.
- Binary scientific data such as `.mat` files is not interpreted.
- Images, audio, video, PDFs, and office documents may require Graphify extras that Second Brain does not bundle.
- Generated, vendored, ignored, or unsupported files can produce incomplete graphs.

## Host contract

The Pi-facing compatibility surface is isolated in `src/pi-host.ts` and covered by adapter tests. It includes package resource discovery, extension flags, dynamic tool activation, session lifecycle events, trusted-project state, active-branch entries, nested model completion, non-context audit entries, and RPC framing.

The Graphify compatibility patch adds project-scoped `refresh_graph`, explicit memory-node indexing, source links, and `summary` parsing. It does not introduce a separate retrieval store or change the graph traversal model. Refresh processes start from the packaged Graphify project so target-repository modules cannot shadow the runtime.

The upstream Graphify Pi skill is not activated. Second Brain ships its own skill and never uses Graphify's automatic `save-result` workflow; `/remember` remains the sole persistence boundary.

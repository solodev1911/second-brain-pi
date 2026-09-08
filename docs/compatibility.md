# Compatibility contract

Verified on 2026-09-07:

- Pi `0.85.1`, Node.js `22.23.2`, npm `10.9.8`.
- Graphify branch `v8`, package `0.9.55`, baseline commit `c9f99018774e2e0380e9f65b3959944559a0d5f6`.
- MCP SDK `1.30.0`, Graphify MCP runtime `1.29.0`, Python `3.14.6` in the checkout `.venv`.

Pi surfaces exercised by the suite: package resource discovery, extension flags, dynamic tool registration/activation, tool-call IDs and result details, session start/shutdown/tree/settled events, trusted-project state, active-branch raw entries, non-context custom entries, nested model completion, RPC command discovery, RPC notifications, and strict JSONL framing. Compatibility-sensitive calls are isolated in `src/pi-host.ts` and covered by focused adapter tests.

The checked-out Graphify v8 did not originally expose `refresh_graph` or index query memories as nodes. The adjacent compatibility patch adds those two narrow capabilities and extends the existing frontmatter parser with `summary`; it does not change Graphify traversal semantics or add a retrieval store. Refresh children run from the Graphify package root to prevent target-project package shadowing, and the server reports memory counts without a redundant second graph rewrite.

The separately shipped Graphify Pi skill is not installed in the user's Pi configuration. Its source still documents `save-result`; Second Brain therefore ships a uniquely named skill and never depends on or activates that automatic persistence workflow.

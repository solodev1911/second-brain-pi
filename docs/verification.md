# Verification

The automated gates cover:

- Trusted-root discovery, explicit-root confinement, and symlink escape rejection.
- Configuration precedence and the Python versus `graphify-mcp` argument profiles.
- Exact distillation framing, one repair, deterministic fallback, limits, and credential redaction.
- Latest-turn selection, A-success/B-failure rejection, pending tool calls, and forged/mismatched provenance.
- YAML-safe memory serialization, hard-link publication, pre-publication revalidation, parallel exact dedupe, and cleanup.
- Real Graphify stdio discovery, refresh payload/path validation, fresh code extraction, memory-node/link indexing, retrieval, and cross-project isolation.
- Real Pi RPC command and packaged-skill discovery, deterministic provider turn, `/remember`, post-publication refresh, duplicate reuse, notifications, audit receipts, and JSONL framing.
- A second fresh Pi process querying Graphify, receiving the saved memory node, and answering from that result.
- A real packed tarball installed into a clean dependency tree, loaded by Pi, and removed again.

Run the complete credential-free gate from this directory with `npm run check`, followed by `npm run pack:check`. Run Graphify's compatibility tests with:

```sh
cd graphify
.venv/bin/python -m pytest -q tests/test_memory_links.py tests/test_reflect.py
```

The real-model acceptance step is intentionally separate. Set `SECOND_BRAIN_LIVE_PROVIDER` and `SECOND_BRAIN_LIVE_MODEL`, then run `npm run test:live`. The harness exercises three stored explanations, five fresh-session prompts, memory-return evidence, source verification, an unrelated negative case, stale-source correction, and correction-preserving dedupe.

Latest local results on 2026-09-07:

- `npm run check`: PASS — 19 unit tests, one expanded real Graphify stdio contract, and two Pi RPC scenarios pass. The second RPC scenario installs the package in a fixture, captures in one process, then retrieves the memory through `query_graph` in a fresh process.
- Fresh-session fixture evidence: `graphify-out/memory/query_20260907_164431_844_where_is_the_invoice_total_calculated.md`; the next process received both `calculate_total()` and that memory node, then emitted `RECALLED_FROM_GRAPH`.
- `npm run pack:check`: PASS — 26 allowlisted files; tarball extraction/install, Pi extension import, skill discovery, and removal all pass.
- Project-local activation: PASS — Pi discovers `/remember`, `/memory-status`, `/graph-refresh`, and `skill:second-brain` from the checkout's `.pi/settings.json`; `/graph-refresh` reports 15,768 nodes and 29,467 edges.
- Graphify changed-surface suite: PASS — 251 tests passed in the expanded serve/memory/reflect/CLI selection; a final direct rerun of the two new test modules passed 9/9 and Ruff passed with `--no-cache`.
- Real-model acceptance: NOT RUN — `pi auth check --provider google --no-refresh --json` returned `credentials_not_configured`, and no other provider credential or API-key environment variable is present. Deterministic retrieval is verified; production-model recall quality is not claimed.
- Platform: macOS arm64 PASS for the gates above. Windows is NOT RUN.

An earlier full upstream Graphify run before the final refresh-hardening patch had 5,341 passes and 92 skips, with five unrelated baseline/optional-extra failures. A later sandboxed full run after the patch was dominated by environment restrictions (repository writes, sockets/DNS, and optional OpenAI dependencies), so the focused 251-test changed-surface result is the authoritative regression gate for the final patch.

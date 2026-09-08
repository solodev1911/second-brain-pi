# Implementation progress

Updated: 2026-09-07

| Phase | Status | Evidence |
|---|---|---|
| 0 — compatibility | PASS | Pi 0.85.1 host APIs and Graphify 0.9.55 stdio MCP exercised with real processes. |
| 1 — package and lifecycle | PASS | Project-local package loads; trusted root/config, status, teardown, and unavailable states are tested. |
| 2 — graph retrieval | PASS | Eight native tools discovered and exercised through the real MCP server; project root is host-injected. |
| 3 — command isolation | PASS | Active-branch selection, failed-later-turn rejection, pending tools, and explicit `/remember` semantics are tested. |
| 4 — durable capture | PASS | Distillation/repair/fallback, redaction, atomic publication, conservative dedupe, locking, and Graphify parsing are tested. |
| 5 — refresh and recovery | PASS | Post-publication refresh, per-memory verification, audit receipt, zero-link memory, failure reporting, cancellation, and recovery are tested. |
| 6 — end to end | PASS / NOT RUN | Deterministic two-process fresh-session recall passes. Real-model acceptance is NOT RUN because Pi has no configured provider credentials. |
| 7 — handoff | PASS on macOS | Packed tarball installs into a clean tree, loads extension and skill in Pi, and removes cleanly. Windows is NOT RUN. |

## Decisions and deviations

- MCP SDK is pinned to 1.30.0 instead of the plan's starting suggestion of 1.25.1 because the older version produced high-severity audit findings.
- `startupRefresh` is `off` in the local trial configuration so launching Pi does not unexpectedly rebuild a 15k-node workspace; `/graph-refresh` is verified explicitly.
- The real target project contains a sibling directory named `graphify`. The refresh subprocess therefore runs from the trusted Graphify package root, never from the indexed project, preventing Python package shadowing.
- No real-project test memory is seeded. The real memory directory remains absent until the user explicitly enters `/remember` after an answer.

## Commands run for the final deterministic gate

```sh
npm run check
npm run pack:check

cd graphify
.venv/bin/python -m pytest -q tests/test_memory_links.py tests/test_serve_refresh.py
.venv/bin/ruff check --no-cache graphify/cli.py graphify/reflect.py graphify/serve.py graphify/memory_links.py tests/test_memory_links.py tests/test_serve_refresh.py
git diff --check
```

## Current blocker

`npm run test:live` requires `SECOND_BRAIN_LIVE_PROVIDER` and `SECOND_BRAIN_LIVE_MODEL` naming a provider/model already authenticated in Pi. The current Google provider readiness check returned `credentials_not_configured`; no provider secrets were read or logged.

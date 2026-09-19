# Development workspace

This repository contains a Pi extension, its Graphify runtime, and the tests that bind them together.

## Layout

- `extensions/second-brain.ts` — Pi extension entry point and command registration.
- `src/` — trusted-root resolution, configuration, Graphify MCP client, capture pipeline, and Pi host adapter.
- `skills/second-brain/` — packaged Pi guidance for graph-first retrieval and source verification.
- `tests/` — unit, Graphify contract, Pi RPC, and fresh-session recall coverage.
- `scripts/` — packed-artifact and bounded live-model acceptance harnesses.
- `graphify/` — vendored Graphify runtime with narrow refresh and memory-indexing patches.
- `.pi/second-brain.example.json` — optional advanced configuration template.
- `graphify-out/` — generated graph data for this checkout; ignored by Git.

The checkout's own graph and memories are development artifacts, not package content or release evidence.

## Bootstrap

```sh
npm ci --legacy-peer-deps

cd graphify
uv sync --frozen --extra mcp
cd ..
```

Install this checkout in a disposable Pi configuration when testing local changes. Do not replace your normal global package unless that is the behavior under test.

## Exercise the extension

Start Pi from a trusted fixture repository and run:

```text
/second-brain-doctor
/graph-refresh
/memory-status
```

Ask a repository question, wait for the answer to settle, and enter `/remember`. Start a fresh session before testing recall so session context cannot masquerade as memory retrieval.

## Verify changes

Run:

```sh
npm run check
npm run pack:check
git diff --check
```

See [Verification](verification.md) for Graphify and real-model acceptance commands. Changes that affect package contents, runtime discovery, or first launch must be validated from the packed tarball in a clean environment.

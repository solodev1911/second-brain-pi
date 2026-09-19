# Contributing

Thank you for helping make Second Brain safer and easier to use. Bug reports, documentation fixes, compatibility findings, tests, and focused code changes are welcome.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before opening an issue

1. Search [existing issues](https://github.com/solodev1911/second-brain-pi/issues).
2. Update Pi, Second Brain, Node.js, and `uv` when practical.
3. Run `/second-brain-doctor` inside the affected repository.
4. Remove credentials, private source, absolute home paths, and memory contents from logs.

Use a [bug report](https://github.com/solodev1911/second-brain-pi/issues/new?template=bug.yml) for reproducible failures and a [feature request](https://github.com/solodev1911/second-brain-pi/issues/new?template=feature.yml) for proposed behavior.

For vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of opening an issue.

## Development setup

Prerequisites:

- Node.js 22.19 or newer
- Pi 0.85.1 or newer
- `uv`
- Git

Set up a checkout:

```sh
git clone https://github.com/solodev1911/second-brain-pi.git
cd second-brain-pi
npm ci --legacy-peer-deps

cd graphify
uv sync --frozen --extra mcp
cd ..
```

Run the credential-free gate:

```sh
npm run check
npm run pack:check
```

Run the focused Graphify compatibility tests:

```sh
cd graphify
uv run --frozen --extra mcp pytest -q tests/test_memory_links.py tests/test_serve_refresh.py
```

The real-model suite spends provider tokens and is not required for ordinary pull requests. Maintainers run it for release candidates:

```sh
export SECOND_BRAIN_LIVE_PROVIDER='<pi-provider-id>'
export SECOND_BRAIN_LIVE_MODEL='<pi-model-id>'
npm run test:live
```

## Design principles

Changes should preserve these invariants:

- `/remember` is the only persistence boundary.
- Nothing is saved automatically at the end of a turn.
- Every project remains isolated to its trusted root.
- Model-controlled inputs cannot select a filesystem root or executable.
- Current source is verified before a remembered conclusion is acted on.
- Tool schemas and output sizes remain bounded.
- A failed refresh never pretends that a saved memory was indexed.
- No telemetry, hosted database, embeddings, or vector store are introduced without an explicit project decision.

The Pi compatibility boundary belongs in `src/pi-host.ts`. Graphify-specific process and MCP behavior belongs behind the Graphify client/service boundary. Changes to the vendored Graphify runtime should be narrow, tested, and recorded in `THIRD_PARTY_NOTICES.md` when the modified surface changes.

## Pull requests

- Keep each pull request focused.
- Add or update tests for behavior changes.
- Update public documentation and `CHANGELOG.md` when users will notice the change.
- Do not commit `node_modules/`, `.venv/`, `graphify-out/`, credentials, or machine-specific `.pi/second-brain.json` files.
- Run `npm run check`, `npm run pack:check`, and `git diff --check` before requesting review.
- Complete the pull-request template and describe any untested platform or provider behavior.

Contributions are submitted under the repository's [Apache License 2.0](LICENSE).

# Verification

Second Brain tests the package at four boundaries: pure TypeScript behavior, the real Graphify process, the real Pi host, and the packed npm artifact.

## Credential-free gate

Run from the repository root:

```sh
npm ci --legacy-peer-deps
npm run check
npm run pack:check
```

`npm run check` includes:

- strict TypeScript checking;
- trusted-root discovery and path-confinement tests;
- configuration precedence and runtime discovery;
- settled-turn selection and invalid capture rejection;
- distillation, repair, fallback, limits, and redaction;
- YAML-safe, atomic, deduplicated memory publication;
- a real Graphify stdio contract and refresh;
- real Pi RPC command/skill discovery and capture; and
- a second fresh Pi process retrieving the saved memory.

`npm run pack:check` builds the actual npm tarball and installs it into a clean temporary environment. The gate must verify the tarball contents, package loading, skill discovery, first-run Graphify startup, command availability, graph refresh, and clean removal. Testing the checkout alone is not sufficient for a release.

CI and the release workflow also audit the production npm dependency tree and the exact frozen Python runtime exported from `graphify/uv.lock`. A release is blocked by high-severity npm findings or any Python advisory reported by `pip-audit`.

Run the changed-surface Graphify tests with:

```sh
cd graphify
uv run --frozen --extra mcp pytest -q tests/test_memory_links.py tests/test_serve_refresh.py
uv run --frozen --extra mcp ruff check --no-cache \
  graphify/cli.py graphify/reflect.py graphify/serve.py graphify/memory_links.py \
  tests/test_memory_links.py tests/test_serve_refresh.py
```

## Real-model acceptance

This gate is separate because it spends model-provider tokens. Authenticate the provider in Pi, then run:

```sh
export SECOND_BRAIN_LIVE_PROVIDER='<pi-provider-id>'
export SECOND_BRAIN_LIVE_MODEL='<pi-model-id>'
pi auth check --provider "$SECOND_BRAIN_LIVE_PROVIDER" --model "$SECOND_BRAIN_LIVE_MODEL" --json
npm run test:live
```

The bounded harness stores three explanations and runs five fresh-session prompts. It covers paraphrased recall, an unrelated negative case, source-over-stale-memory behavior, and a corrected conclusion. It must never print credentials or model reasoning.

## Release checklist

Before publishing a version:

1. Start from a clean checkout at the release commit.
2. Run the credential-free gate and focused Graphify tests.
3. Run the real-model acceptance gate with the intended Pi version.
4. Test the documented install, update, and uninstall commands from a clean Pi home.
5. Launch Pi in an unrelated fixture repository and run `/second-brain-doctor` and `/graph-refresh`.
6. Save a conclusion with `/remember`, close Pi, and verify recall in a fresh process.
7. Confirm `graphify-out/` data remains isolated to the fixture repository.
8. Inspect `npm pack --dry-run` for secrets, machine paths, generated memory, and missing licenses.
9. Confirm CI passes on every platform advertised in the README.
10. Update `CHANGELOG.md`, create a signed version tag, publish through trusted publishing, and verify npm provenance.

Do not substitute source-tree tests for a packed-artifact install. Public users receive the tarball, not the maintainer's checkout.

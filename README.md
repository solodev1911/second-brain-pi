# second-brain

An explicit-save, globally installable and repository-isolated second brain for Pi 0.85.1 backed by Graphify v8. It adds native graph retrieval tools plus `/remember`, `/memory-status`, and `/graph-refresh`. Nothing is saved automatically: entering `/remember` is the approval boundary for the latest settled answer on the active session branch.

## What it does

- Resolves one canonical trusted project root and never exposes root/executable fields to the model.
- Connects to Graphify over owned stdio MCP, discovers capabilities, and activates only the tools the backend actually provides.
- Adds `query_graph`, `refresh_graph`, `get_node`, `get_neighbors`, `get_community`, `god_nodes`, `graph_stats`, and `shortest_path` with bounded, closed schemas.
- Distils the latest completed answer with Pi's active model, repairs malformed output once, and falls back deterministically without citations if the nested completion is unavailable.
- Publishes Markdown under `graphify-out/memory/` using an exclusive hard-link transaction and exact question+answer deduplication.
- Refreshes Graphify after publication, verifies the exact memory node and real `relation: memory` link count, and appends a non-context session receipt.

No embeddings or vector database are introduced.

## Prerequisites

- Node.js 22.19 or newer (verified with 22.23.2).
- Pi 0.85.1 (`@earendil-works/pi-coding-agent`).
- [`uv`](https://docs.astral.sh/uv/) for Graphify's Python environment.
- The bundled `graphify/` source, which includes the Second Brain compatibility patch.

## Clone and bootstrap

```sh
git clone https://github.com/solodev1911/second-brain-pi.git
cd second-brain-pi
npm install --legacy-peer-deps

cd graphify
uv sync --frozen --extra mcp
cd ..
```

Keep this checkout in a stable location. Pi loads the package globally from this
checkout and automatically uses its patched Graphify runtime.

## Install once for Pi

Set `SECOND_BRAIN_CHECKOUT` to the absolute path of the cloned repository, then
install the package globally. Do not pass `-l`:

```sh
SECOND_BRAIN_CHECKOUT=/absolute/path/to/second-brain
pi install "$SECOND_BRAIN_CHECKOUT" --approve
```

Restart Pi inside any trusted Git repository. The extension detects that
repository as the project root, while the Graphify process is discovered from
`$SECOND_BRAIN_CHECKOUT/graphify/.venv`. Each repository keeps its own graph and
memories under `graphify-out/`.

No per-repository package installation, environment activation, or Graphify
configuration is required. If a repository needs an explicit engine override,
copy the portable example into that repository's `.pi/` directory:

```sh
mkdir -p .pi
cp "$SECOND_BRAIN_CHECKOUT/.pi/second-brain.example.json" .pi/second-brain.json
```

The example deliberately runs `graphify-mcp` from `PATH`, overriding automatic
runtime discovery. Activate the desired environment before starting Pi:

```sh
source "$SECOND_BRAIN_CHECKOUT/graphify/.venv/bin/activate"
pi --approve
```

For a durable profile that does not require activation, edit the copied
`.pi/second-brain.json` in the target project and replace its `graphify` object
with absolute paths for this machine:

```json
{
  "schemaVersion": 1,
  "graphify": {
    "command": "/absolute/path/to/second-brain/graphify/.venv/bin/python",
    "args": ["-m", "graphify.serve"],
    "cwd": "/absolute/path/to/second-brain/graphify"
  },
  "startupRefresh": "off"
}
```

Keep `.pi/second-brain.json` local because it contains machine-specific paths.
The tracked `.pi/second-brain.example.json` is an optional override template.

You can also skip the project config and launch Pi with explicit flags:

```sh
pi --approve \
  --second-brain-graphify-command "$SECOND_BRAIN_CHECKOUT/graphify/.venv/bin/python" \
  --second-brain-graphify-engine-root "$SECOND_BRAIN_CHECKOUT/graphify"
```

The matching environment variables are `SECOND_BRAIN_GRAPHIFY_COMMAND`, `SECOND_BRAIN_GRAPHIFY_ENGINE_ROOT`, `SECOND_BRAIN_PROJECT_ROOT`, and `SECOND_BRAIN_STARTUP_REFRESH`. The startup-refresh value is `background` (default) or `off`. An explicit project root must be an ancestor of Pi's trusted current directory.

## Use

1. Ask a repository question normally. For architecture and implementation-flow questions, the connected skill guides Pi to query Graphify first and verify current files.
2. After Pi finishes the answer, enter `/remember` by itself.
3. Use `/memory-status` for the resolved project/engine and last receipt.
4. If a file was saved but indexing failed, use `/graph-refresh` to recover.

`/remember` accepts no arguments and stores text only. It does not approve a pending action—even if the captured answer ends with “Should I implement this?”—and it refuses a running, failed, aborted, or tool-pending answer.

## Development and verification

```sh
npm install --legacy-peer-deps
npm run check
npm run pack:check
```

`npm run check` is credential-free and includes strict type checking, unit tests,
the real Graphify stdio contract, Pi RPC capture, and a two-process fresh-session
recall test. `npm run pack:check` builds a tarball, installs that artifact into a
clean temporary dependency tree, loads its extension and skill through Pi, then
removes it.

The bounded real-model acceptance harness is separate because it spends provider
tokens. Authenticate the provider in Pi, then identify it explicitly:

```sh
export SECOND_BRAIN_LIVE_PROVIDER='<pi-provider-id>'
export SECOND_BRAIN_LIVE_MODEL='<pi-model-id>'
pi auth check --provider "$SECOND_BRAIN_LIVE_PROVIDER" --model "$SECOND_BRAIN_LIVE_MODEL" --json
npm run test:live
```

The live harness creates and removes an isolated fixture. It stores three
explanations, runs five fresh-session prompts (including two paraphrases and one
unrelated negative case), changes the current billing implementation, verifies
that source wins over stale memory, and saves a distinct corrected conclusion.
It never prints credentials or model reasoning.

See [compatibility](docs/compatibility.md) and [verification](docs/verification.md) for the frozen host/backend contract and test coverage.

## Remove

Run `pi remove "$SECOND_BRAIN_CHECKOUT" --approve`. Removal disables the global
package; it intentionally does not delete any repository's
`graphify-out/memory/` or rewrite existing memories.

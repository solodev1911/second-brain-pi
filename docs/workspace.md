# second-brain workspace

This directory is the development checkout for Second Brain.

Current state: the package is enabled locally for this directory, Pi reports the
integration as connected, and the generated project graph is present. The last
verified refresh contained 15,768 nodes and 29,467 edges.

## Components

- `extensions/second-brain.ts` — Pi extension entry point.
- `src/`, `skills/second-brain/`, `tests/`, and `scripts/` — Graphify MCP client, capture pipeline, packaged skill, tests, and development tooling.
- `graphify/` — Graphify v8 checkout with the Second Brain memory-indexing and `refresh_graph` compatibility patch.
- `.pi/settings.json` — project-local Pi package registration.
- `.pi/second-brain.example.json` — tracked, portable Graphify configuration template.
- `.pi/second-brain.json` — untracked, machine-local Graphify configuration.
- `graphify-out/` — generated graph for this workspace.

## Run it

After completing the bootstrap and local configuration steps in the root
`README.md`, start Pi from the checkout root:

```sh
pi --approve
```

Inside Pi:

1. Run `/memory-status`; it should report `connected` and `Graph: present`.
2. Ask a repository question.
3. Run `/remember` after the completed answer to approve saving it.
4. Start a fresh Pi session and ask a related question to exercise recall.

The memory directory is intentionally absent until the first explicit `/remember` command. Test memories are never seeded into this real project.

The only unexecuted release gate is the bounded real-model acceptance run because
Pi currently has no configured provider credentials. Credential-free capture and
fresh-session recall are covered by a two-process RPC test.

## Verify the implementation

Run these commands from the checkout root:

```sh
npm run check

cd graphify
.venv/bin/python -m pytest tests/test_memory_links.py -q
```

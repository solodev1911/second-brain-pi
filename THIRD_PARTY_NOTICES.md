# Third-party notices

## Graphify

This repository vendors and distributes a modified Graphify v0.9.64
(`b9cd957`) runtime from <https://github.com/Graphify-Labs/graphify> under the
Apache License 2.0. The upstream `LICENSE`, `LICENSE-MIT`, and `NOTICE` files
remain in `graphify/` and are included in distributed packages.

The second-brain project modifies Graphify to:

- expose a project-scoped `refresh_graph` MCP tool;
- index explicit second-brain memory records and their source links; and
- preserve the memory `summary` field during reflection parsing; and
- refresh the frozen dependency lock for security-fixed transitive versions.

The modified implementation is in:

- `graphify/graphify/cli.py`
- `graphify/graphify/reflect.py`
- `graphify/graphify/serve.py`
- `graphify/graphify/memory_links.py`
- `graphify/tests/test_memory_links.py`
- `graphify/tests/test_serve_refresh.py`

Graphify is a separate project and is not affiliated with or maintained by the
Second Brain project. Upstream issues should be reported to Graphify only when
they also reproduce without Second Brain's patches.

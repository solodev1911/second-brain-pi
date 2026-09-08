# Third-party notices

## Graphify

This repository vendors Graphify v0.9.55 from
<https://github.com/Graphify-Labs/graphify> under the Apache License 2.0.
The original license and notice files remain in `graphify/`.

The second-brain project modifies Graphify to:

- expose a project-scoped `refresh_graph` MCP tool;
- index explicit second-brain memory records and their source links; and
- preserve the memory `summary` field during reflection parsing.

The modified implementation is in:

- `graphify/graphify/cli.py`
- `graphify/graphify/reflect.py`
- `graphify/graphify/serve.py`
- `graphify/graphify/memory_links.py`
- `graphify/tests/test_memory_links.py`
- `graphify/tests/test_serve_refresh.py`

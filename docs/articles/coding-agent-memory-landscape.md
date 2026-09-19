# Coding-agent memory and repository context: a source survey

**Research date:** 2026-09-19
**Status:** Publication research, not a product ranking

## Purpose

“Memory” in a coding agent can refer to at least four different things: preserving a conversation, indexing the current repository, retaining preferences, or carrying a verified conclusion into a later session. Products that use the same word may therefore solve different problems.

This survey maps the current design space around one question:

> How can a coding agent retain useful knowledge across sessions without making stale or weakly supported conclusions look like current repository truth?

It covers repository-native context, code indexes and graphs, hosted coding-agent memories, and general agent-memory frameworks. It does not score vendors. Claims below are based on first-party documentation and repositories, not a common benchmark.

## Disclosure and method

I built [Second Brain for Pi](../../README.md), which is included only as one design point near the end. The comparison is therefore not independent.

For each system, I reviewed its official documentation or repository for:

1. **Capture policy** — automatic extraction, agent-selected writes, explicit user save, or normal file review.
2. **Scope** — session, repository, user, agent, team, or corpus.
3. **Representation and retrieval** — files, vectors, structural graph, temporal graph, or a hybrid.
4. **Provenance** — whether a remembered claim can be traced to a source.
5. **Freshness and correction** — how the system detects or handles change.
6. **Auditability** — whether users can inspect, edit, export, or delete records.
7. **Operational profile** — local or hosted storage, external services, and setup burden.

“Documented” below means the behavior is stated by the project’s primary source. “Inference” means it is a comparative interpretation, not a vendor claim. Product behavior and terms can change; follow the links before making a production decision.

## First distinction: context is not necessarily memory

A repository map can help an agent answer a question today without retaining anything from the conversation. A persistent user profile can survive for years without understanding a call graph. An architecture decision record may be durable and authoritative even though it has no retrieval engine.

The most useful taxonomy is therefore based on the object being retained:

- **Working context:** material available to the model during the current turn.
- **Episodic history:** what happened in a prior session.
- **Semantic memory:** facts or preferences intended to survive beyond one session.
- **Procedural knowledge:** rules that tell the agent how to work.
- **Structural knowledge:** relationships derived from the current repository or corpus.
- **Experiential conclusions:** explanations, dead ends, and decisions learned through work.

This separation is consistent with the broader agent-memory literature. Recent surveys emphasize that memory design includes representation, consolidation, updating, indexing, forgetting, retrieval, and compression—not merely storage ([Zhang et al., 2024](https://arxiv.org/abs/2404.13501); [Du et al., 2025](https://arxiv.org/abs/2505.00675)).

## Landscape at a glance

| System | Primary job | What persists | Admission control | Retrieval model | Freshness/provenance |
|---|---|---|---|---|---|
| Repository files / Continue rules | Durable instructions and documentation | Human-authored text | File edit and review | Always-loaded or tool-selected text | Git history; quality depends on maintenance |
| Aider repo map | Compact current-code context | Derived symbol/dependency map | Automatic from source | Graph-ranked map within a token budget | Refreshes from repository source |
| Graphify | Repository/corpus graph plus work memory | Graph, saved results, outcomes, reflections | Caller/agent invokes save | Structural traversal and graph queries | Source locations, confidence, and stale-source warnings |
| CodeGraph | Code intelligence plus project notes | Code graph, embeddings, explicit memories | Agent/client invokes memory tools | Graph, BM25, and semantic search | Incremental code index; memories can be invalidated |
| GitNexus | Architecture and impact analysis | Repository knowledge graph | Automatic from source | Graph, BM25, semantic search, impact tools | Compares index state with Git |
| GitHub Copilot Memory | Hosted repository facts and user preferences | Selected facts/preferences | Copilot selects after enabled user activity | Hosted memory plus semantic repository index | Code citations, current-branch validation, 28-day unused expiry |
| Cursor Memories | Project rules learned from chats | Approved or agent-created rules | Approval for background proposals; agent tool writes also exist | Rules injected into context plus code index | Project scoped; no documented source-fingerprint validation |
| LangMem | Memory-building primitives for agents | Facts, episodes, and procedural memories | Agent hot path or background extraction | Application-defined store, often semantic | Application-defined update and provenance policy |
| Letta | Persistent stateful agents | In-context blocks, files, history | Agent/user-managed | Attached blocks, files, and recall | Persistent blocks/files/history; optional Git backing in supported configurations |
| Mem0 | General personalization and conversational memory | Extracted or raw memories | Application write, usually LLM extraction | Vector/keyword/entity and optional graph context | History/expiry features; not code-source validation |
| Cognee | Broad graph/vector agent memory | Documents, code, sessions, graph knowledge | Explicit API/tool writes plus optional processing | Graph, vector, code, and hybrid recall | Provenance and deletion features; policy is configurable |
| Graphiti | Evolving temporal knowledge | Episodes, entities, time-bounded facts | Application adds episodes; model extracts graph | Semantic, BM25, temporal graph traversal | Episode provenance and validity windows |
| Microsoft GraphRAG | Structured retrieval over a corpus | Extracted graph, communities, reports, vectors | Batch/update indexing | Local, global, DRIFT, and vector search | Source text units; refresh requires index/update pipeline |
| Second Brain for Pi | Explicit project conclusions attached to code structure | Repository-local Markdown plus graph nodes | User invokes `/remember` | Graphify structural queries | Optional source links; agent is instructed to verify current source |

The table intentionally puts dissimilar systems side by side. The sections below explain where the apparent overlaps end.

## 1. Repository-native files and Continue rules

The simplest memory layer is often a collection of README files, architecture decision records, contribution guides, and agent instructions. Continue’s current [rules documentation](https://docs.continue.dev/customize/rules) makes this model explicit: Markdown under `.continue/rules` can be version controlled with the project and used to guide the agent. Its [codebase-awareness guide](https://docs.continue.dev/guides/codebase-documentation-awareness) now emphasizes live file/search/Git tools, rules, and MCP; the earlier `@Codebase` context provider is [deprecated](https://docs.continue.dev/reference/deprecated-codebase).

**Best fit:** Stable knowledge that humans should also read and review.

**Boundary:** Authoring and maintenance are explicit; retrieval depends on the configured rule mode. Files can contradict one another, and useful investigation results are easy to leave in chat rather than promote into documentation.

## 2. Aider: repository-map context

Aider builds a concise [repository map](https://aider.chat/docs/repomap.html) containing important files, symbols, signatures, and dependency relationships. A graph-ranking algorithm selects the most relevant pieces for the active chat within a configurable token budget. Its [map refresh options](https://aider.chat/docs/config/options.html) can update automatically, always, on file changes, or manually.

This is excellent structural context, but it is not a durable store for “why this design exists” or “what we learned yesterday.”

**Best fit:** Giving an editing model compact orientation across a repository.

**Boundary:** It compresses current source; it does not provide a documented admission and correction lifecycle for long-term experiential conclusions.

## 3. Code graphs: Graphify, CodeGraph, and GitNexus

These projects share an important premise: source code is relational. Callers, imports, definitions, and execution paths often matter more than semantically similar text chunks.

### Graphify

[Graphify](https://github.com/Graphify-Labs/graphify/blob/v8/README.md) parses code locally with tree-sitter, records structural relationships, labels extracted and inferred edges, and exposes graph queries without requiring a vector index. It also has its own work-memory features: saved question/answer results, outcome labels such as `useful`, `dead_end`, and `corrected`, plus deterministic reflection and source-change warnings.

**Best fit:** Local, auditable repository or mixed-corpus understanding where structural paths and prior query outcomes should be queryable.

**Boundary:** The base Graphify workflow can let the agent save results. A separate integration must impose a stricter human-approval policy if that is required.

### CodeGraph

[CodeGraph](https://github.com/codegraph-ai/CodeGraph) combines a semantic code graph with BM25, embeddings, HNSW, and a persistent memory layer. Its explicit memory tools can store, search, contextualize, list, and invalidate project notes. The same system also exposes callers, callees, dependency, impact, and change-analysis tools.

**Best fit:** A local code-intelligence system that also needs searchable architectural decisions, root causes, and known issues.

**Boundary:** Its client or agent policy determines who authorizes each memory write. The reviewed documentation does not require every memory to carry a source citation or fingerprint.

### GitNexus

[GitNexus](https://github.com/abhigyanpatwari/GitNexus) indexes a codebase into a persistent LadybugDB graph and exposes context, impact, trace, change-detection, and Cypher tools. It combines structural retrieval with BM25 and optional semantic search, and reports whether an index is current, behind, or diverged from Git.

**Best fit:** Local call-chain, architecture, execution-flow, and blast-radius analysis.

**Boundary:** It primarily remembers derived current-code structure, not a curated history of team conclusions. The repository uses the [PolyForm Noncommercial 1.0.0 license](https://github.com/abhigyanpatwari/GitNexus/blob/main/LICENSE), so commercial users should review whether they need separate permission.

## 4. Hosted coding-agent memories: GitHub Copilot and Cursor

These are two examples of memory integrated directly into a coding product.

### GitHub Copilot Memory

[Copilot Memory](https://docs.github.com/en/copilot/concepts/agents/copilot-memory) is currently documented as a public-preview feature for paid Copilot plans. It stores repository facts—such as conventions, decisions, commands, and rules—and user-level preferences. Repository facts include code citations and are checked against the current branch before use. Unused entries are deleted after 28 days, although successful validation and use may reset that period. Owners and users can review and delete memories.

Copilot’s separate [repository indexing](https://docs.github.com/en/copilot/concepts/context/repository-indexing) supplies semantic code search and is usually refreshed shortly after a new conversation begins.

**Best fit:** Teams already using GitHub and Copilot that want low-friction, cross-feature repository memory with documented source validation.

**Boundary:** Copilot chooses the individual facts after enabled user activity; this is not the same as a user explicitly approving each remembered answer. Storage and retrieval are hosted, and indexing a non-GitHub repository can upload workspace data to GitHub when the relevant policy is enabled.

### Cursor Memories

[Cursor Memories](https://docs.cursor.com/en/context/memories) turns conversation-derived information into project-scoped rules. A background sidecar can propose memories that require user approval, while the agent can also create memories through tool calls when asked—or when it judges something important. Memories can be managed in Cursor settings. Cursor also supports explicit [project rules](https://docs.cursor.com/context/rules) and semantic code indexing.

**Best fit:** Developers who want project-scoped conventions and lessons to accumulate inside Cursor through background proposals and agent-initiated writes.

**Boundary:** The reviewed memory documentation does not describe mandatory code citations, source fingerprints, or expiry for each generated memory. The memory is a rule-like context item rather than a structural source graph.

## 5. Frameworks for building agent memory

These systems are broader than coding. They are useful when memory is part of an application architecture rather than a feature of one editor.

### LangMem

[LangMem](https://github.com/langchain-ai/langmem) offers storage-agnostic primitives for semantic, episodic, and procedural memory. An agent can manage memory “in the hot path,” or a background process can automatically extract and consolidate memories from conversations. Hierarchical namespaces can model users, agents, organizations, or applications.

**Best fit:** Building a custom memory policy into a LangGraph application.

**Boundary:** It is a toolkit, not a ready-made coding memory. Repository structure, provenance, and source-authority rules are left to the application.

### Letta

[Letta](https://docs.letta.com/v1-sdk/concepts/stateful-agents) treats the agent itself as persistent. Memory blocks remain visible while attached and can be shared, detached, and reattached; its [block documentation](https://docs.letta.com/tutorials/attaching-detaching-blocks/) describes them as structured sections of persistent agent context.

This direction follows the virtual-memory framing introduced by [MemGPT](https://arxiv.org/abs/2310.08560): move information between tiers so an agent can behave as though it has context beyond a single model window.

**Best fit:** Persistent agent identity, long-running relationships, and continuously available state.

**Boundary:** An agent’s learned state and a repository’s current truth are different scopes. Code-drift checks must be designed separately.

### Mem0

[Mem0](https://github.com/mem0ai/mem0) provides managed and open-source memory APIs with add, search, update, delete, and history operations. The self-hosted engine supports configurable language models, embedders, vector stores, and rerankers. Optional [Graph Memory](https://docs.mem0.ai/open-source/features/graph-memory) extracts entities and relationships alongside embeddings, returning graph context next to vector results.

**Best fit:** Broad personalization and conversational recall across users, agents, and sessions.

**Boundary:** It is not code-structure-aware by default, and automatic fact extraction requires an application-specific policy for uncertainty, contradiction, and repository scope.

### Cognee

[Cognee](https://github.com/topoteretes/cognee) turns documents, code, and conversations into graph/vector memory. Its [MCP layer](https://github.com/topoteretes/cognee/blob/main/cognee-mcp/README.md) exposes `remember`, `recall`, and `forget`, with session cache and permanent graph-memory paths; its [examples](https://github.com/topoteretes/cognee/blob/main/examples/README.md) cover code graphs, evidence references, temporal recall, and session distillation.

**Best fit:** A broad self-hosted or cloud “company brain” spanning text, code, sessions, and agents.

**Boundary:** It is a larger memory platform. Explicit human admission can be designed, but it is not the universal enforced boundary of the platform.

### Graphiti

[Graphiti](https://github.com/getzep/graphiti) is a temporal knowledge-graph framework. Applications add episodes; Graphiti extracts entities and relationships, gives facts validity windows, preserves superseded history, and supports semantic, keyword, and graph retrieval. Raw episodes remain as provenance.

**Best fit:** Changing real-world facts where both “what is true now?” and “what was true then?” matter.

**Boundary:** It is not a deterministic source-code parser or a ready-made coding workflow. Users provide graph infrastructure, extraction models, and application policy.

> **Naming note:** Graphify and Graphiti are unrelated projects. Graphify is the repository/corpus graph engine used by Second Brain; Graphiti is Zep’s temporal knowledge-graph framework.

## 6. Microsoft GraphRAG: an adjacent corpus system

[Microsoft GraphRAG](https://microsoft.github.io/graphrag/) extracts entities, relationships, and claims from a document corpus, forms communities, generates hierarchical reports, and supports local, global, DRIFT, and basic vector queries. Its [index documentation](https://microsoft.github.io/graphrag/index/overview/) describes Parquet outputs plus a configured vector store.

**Best fit:** Broad synthesis across a document corpus, especially questions about themes or relationships spanning the dataset. Operational privacy depends on the configured models, vector services, and deployment.

**Boundary:** It is a batch/update corpus index, not an interactive coding-agent memory or an approval workflow for conclusions learned during a session.

## 7. Where Second Brain fits

[Second Brain for Pi](../../README.md) is an opinionated Pi integration built on Graphify, not a new graph engine. It uses one global Pi package across trusted repositories while keeping each repository’s graph and saved-memory artifacts in that repository’s `graphify-out/` directory.

Its design center is a narrow capture policy:

- Pi answers a repository question using Graphify-backed context.
- The user decides that the completed answer is worth keeping.
- The user invokes `/remember` with no arguments.
- The extension captures the latest settled answer on the active Pi branch.
- It stores a human-readable Markdown record and links it to canonical graph nodes when same-turn evidence supports those links.
- A later graph query can surface the saved conclusion.
- The agent is instructed to inspect current source before relying on the memory.

The implementation enforces the extension’s explicit write boundary, active-branch selection, exact-duplicate reuse, per-repository scoping, and project-root confinement. “Graph first” and “verify current source” are agent instructions, not formal guarantees of tool order or correctness. Source links establish traceability; they do not prove that every sentence remains true.

Repository-local artifacts do not make the workflow offline or wholly on-device. Pi may send prompts, selected source, graph results, and memory-distillation input to the model provider configured by the user. Installation and the first locked runtime bootstrap also require network access.

**Best fit:** A Pi user who wants a small number of deliberately promoted, project-specific conclusions to survive fresh sessions and remain inspectable next to the code graph.

**Not the best fit:** Automatic personalization, cross-project identity, hosted team sync, temporal modeling of business entities, broad notebook/media understanding, or framework-neutral agent memory.

Second Brain’s intended distinction is therefore not “graph memory.” Graphify, CodeGraph, Cognee, Graphiti, and other systems already demonstrate graph-backed context or memory. The more defensible statement is:

> Second Brain combines Graphify’s structural repository graph with a Pi-native, explicit promotion step for completed answers and a workflow that prompts Pi to re-check remembered implementation claims against current source.

## Practical selection guide

- **Need stable team instructions?** Start with repository-native files and review them through Git.
- **Need compact awareness of current code?** Use a repository map or code index.
- **Need callers, paths, communities, and impact analysis?** Use a structural code graph.
- **Need automatic hosted memory inside an existing coding product?** Examine Copilot Memory or Cursor Memories and their data policies.
- **Need user preferences and fuzzy recall across an application?** Consider Mem0 or a LangMem-based design.
- **Need a persistent agent identity?** Consider Letta’s stateful-agent model.
- **Need changing facts with historical validity?** Consider Graphiti or a similar temporal graph.
- **Need synthesis across a document collection?** Consider GraphRAG.
- **Need deliberately saved conclusions tied to one Pi project?** Second Brain is one option; a plain Markdown design note may still be the better answer when the knowledge deserves team review.

## What a fair evaluation should test

A useful coding-memory benchmark should test more than successful recall:

1. Establish a verified conclusion in one session.
2. Persist it through the system’s intended write path.
3. Retrieve it from a genuinely fresh session using a paraphrased question.
4. Rename a referenced symbol without changing behavior.
5. Change behavior while keeping the symbol name.
6. Measure whether the system repeats stale memory or checks current evidence.
7. Correct the conclusion and test how history is handled.
8. Ask unrelated questions and measure irrelevant retrieval.
9. Open another repository and test isolation.
10. Delete the memory and verify that it is no longer returned.

Report at least correct-recall rate, stale-memory obedience, irrelevant retrieval, unexpected writes, correction behavior, cross-project leakage, latency, model/indexing cost, and ease of inspection and deletion. Use the same model, repositories, questions, and resource limits where possible. Vendor documentation claims and observed results should be reported separately.

## Conclusion

The design question is not whether an agent has a memory feature. It is whether the system’s write authority, scope, evidence, freshness policy, and failure behavior match the knowledge being retained.

For coding agents, recall is only half the problem. Admission control—deciding which generated conclusions deserve durability—and conflict handling—deciding what happens when code changes—are at least as important. The right system may be a sophisticated temporal graph. It may also be a reviewed Markdown file.

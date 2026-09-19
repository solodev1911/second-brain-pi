# Release readiness

This document tracks the engineering gates for the next public release. A checked box means the behavior exists in the release branch; publishing still requires the automated and manual release checklist in [Verification](verification.md).

## Core behavior

- [x] One global Pi package works across trusted repositories.
- [x] Each repository receives an isolated `graphify-out/` graph and memory directory.
- [x] Graphify runs over owned stdio MCP with host-controlled roots and executable configuration.
- [x] Eight bounded graph tools are registered only when supported by the backend.
- [x] `/remember` is explicit, branch-aware, deduplicated, and atomic.
- [x] Saved memory nodes are refreshed and verified against Graphify.
- [x] Fresh Pi sessions can retrieve a previously saved conclusion.
- [x] Package installs can provision the locked Graphify environment through `uv`.
- [x] `/second-brain-doctor` diagnoses the public installation path.

## Public-release foundation

- [x] Apache-2.0 project license and third-party notices.
- [x] Public README, security policy, contribution guide, code of conduct, changelog, and support guide.
- [x] Structured bug and feature issue forms plus a pull-request template.
- [x] Credential-free TypeScript, Graphify contract, Pi RPC, and packed-artifact gates.
- [x] Release automation is designed for npm provenance and trusted publishing.
- [ ] Complete external beta installs on every advertised platform.
- [ ] Promote Windows from experimental after clean installation and recall testing.
- [ ] Add notebook-aware indexing.

## Non-goals for the initial beta

- Automatic persistence at turn end.
- A hosted memory service or synchronization account.
- Embeddings or a vector database.
- Indexing every Graphify-supported optional media/database format.
- Treating remembered conclusions as more authoritative than current source.

## Release policy

The project uses semantic versioning. During `0.x`, minor releases can refine interfaces, but migrations and breaking behavior must be called out in `CHANGELOG.md`. A release must not claim a platform or installation path that has not passed the corresponding clean-environment test.

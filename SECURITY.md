# Security policy

## Supported versions

Security fixes are provided for the latest published version. Pre-release versions are supported on a best-effort basis.

| Version | Supported |
|---|---|
| Latest release | Yes |
| Older releases | No |

## Report a vulnerability

Please do not open a public issue for a suspected vulnerability.

Use GitHub's private vulnerability reporting for this repository:

<https://github.com/solodev1911/second-brain-pi/security/advisories/new>

Include:

- the affected version and operating system;
- a minimal reproduction or proof of concept;
- the impact you believe is possible;
- whether the issue involves a malicious repository, memory file, package, or dependency; and
- any suggested mitigation.

We aim to acknowledge complete reports within seven days and will coordinate disclosure after a fix is available. Please avoid accessing other people's data, disrupting services, or publishing exploit details before remediation.

## Security model

Second Brain is a Pi extension and runs with the permissions of the user who launched Pi. Installing the package therefore means trusting its TypeScript extension and bundled Python runtime.

The project is designed around these boundaries:

- Pi must trust the current repository before Second Brain activates.
- The host resolves and injects the project root; model-facing graph tools cannot choose arbitrary roots or executables.
- Graphify runs as a child process over owned stdio MCP rather than an exposed network service.
- Graph and memory data are repository-local under `graphify-out/`.
- Memories are created only after the user enters `/remember`.
- Repository content, graph results, and memory files are treated as untrusted data rather than instructions.
- Credentials are owned by Pi and its configured model providers; Second Brain does not read or store them.

These controls do not sandbox Pi or the extension. Only install trusted releases, review dependency changes, and do not run Pi in an untrusted repository with sensitive ambient permissions.

## Sensitive data

Saved memories can contain parts of the active conversation, and generated graphs contain source-derived identifiers and relationships. Do not publish `graphify-out/` without reviewing it. Close Pi and delete the directory to remove a repository's generated graph and memories.

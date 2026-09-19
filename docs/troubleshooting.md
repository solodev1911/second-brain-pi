# Troubleshooting

Start with this command inside the repository you want to index:

```text
/second-brain-doctor
```

The diagnostic is designed to report project trust, runtime discovery, `uv`, Graphify startup, and graph health without printing credentials. When opening an issue, remove proprietary paths and content from its output.

## Commands are missing

1. Exit Pi completely and start a new session.
2. Confirm the package is registered with `pi list`.
3. Update the beta with `pi update npm:@solodev1911/second-brain@beta`.
4. Make sure you installed globally—do not use the `-l` flag.
5. Start Pi inside a Git repository and approve that repository when prompted.

If you installed from GitHub rather than npm, use the same source string for update/remove that you used for installation.

## `uv` is missing

Install `uv` using its [official instructions](https://docs.astral.sh/uv/getting-started/installation/), open a new terminal, and verify:

```sh
uv --version
```

Second Brain uses `uv` to create a package-local environment from the committed lockfile. You should not need to activate that environment or install Graphify manually.

## First launch is slow

The first Pi session after installation runs `uv` and downloads the locked Python dependencies. It requires internet access and can take a few minutes. Subsequent sessions reuse the environment.

Wait for initialization, then run `/second-brain-doctor`. A firewall, proxy, offline environment, or unavailable package index can prevent the first-run setup.

## Graphify cannot connect

- Run `/second-brain-doctor` and use its first failing check.
- Confirm `uv` is on the `PATH` visible to Pi, not only an interactive shell alias.
- Check whether `<project>/.pi/second-brain.json` or a `SECOND_BRAIN_GRAPHIFY_*` environment variable overrides automatic discovery.
- Rename a stale local override and restart Pi to return to the bundled runtime.
- Update the package, then restart Pi before retrying.

Do not post raw environment variables or configuration containing sensitive paths.

## The graph is missing or stale

Run:

```text
/graph-refresh
/memory-status
```

Confirm Pi resolved the intended project root. Very large repositories take longer to index. Unsupported, ignored, generated, notebook, and binary files may not appear with useful structure.

## `/remember` saves nothing

`/remember` accepts no arguments and only captures the latest completed assistant answer. It intentionally refuses capture when:

- the model is still running;
- a tool call is pending;
- the last turn failed or was aborted;
- the session branch changed during capture;
- Pi is running in a mode that cannot provide the settled branch; or
- Second Brain is disconnected.

Wait for the answer to finish, run `/memory-status`, and retry `/remember` by itself.

## A memory was saved but not indexed

The Markdown file remains under `graphify-out/memory/`. Fix the Graphify connection, then run `/graph-refresh`. Second Brain will not claim the memory is indexed until it verifies the memory node and its source links.

## Reset one repository

Close Pi, then remove that repository's `graphify-out/` directory. This deletes the generated graph and all Second Brain memories for that repository. It does not uninstall the extension or affect other repositories.

Back up any memory files you want to keep before deleting the directory.

## Still stuck?

Search [existing issues](https://github.com/solodev1911/second-brain-pi/issues), then open a [bug report](https://github.com/solodev1911/second-brain-pi/issues/new?template=bug.yml) with sanitized doctor output and version information.

# Releasing Second Brain

Second Brain is published as `@solodev1911/second-brain`. A GitHub Release is
the only supported publication trigger. The release workflow verifies the tag,
tests the exact release commit, builds one tarball, and publishes that verified
tarball to npm with an OIDC identity and npm provenance.

Do not publish from a developer laptop, add an npm token to GitHub, or rerun a
release with the same version. npm versions are immutable.

## One-time repository setup

1. Confirm that the `@solodev1911` npm scope and the
   `@solodev1911/second-brain` package name are available to the maintainer.
2. On npm, configure a GitHub Actions trusted publisher for:
   - Organization or user: `solodev1911`
   - Repository: `second-brain-pi`
   - Workflow filename: `publish.yml`
   - Environment: `npm`
   - Allowed action: direct `npm publish`
3. In GitHub, create an environment named `npm`. Add required reviewers and
   restrict deployments to tags matching `v*`.
4. Protect `main` and require both CI matrix checks:
   - `Node 22 / ubuntu-latest`
   - `Node 22 / macos-latest`
5. Enable Dependabot alerts and secret scanning. The publishing workflow does
   not require an `NPM_TOKEN` secret.
6. Enable private vulnerability reporting so the links in `SECURITY.md` and the
   issue chooser accept confidential reports.
7. Confirm the default `bug` and `enhancement` labels exist for the structured
   issue forms.
8. Set the repository description, homepage, social preview, and topics. Good
   starting topics are `pi-package`, `pi-coding-agent`, `graphify`,
   `agent-memory`, `knowledge-graph`, and `local-first`.

The trusted-publisher values are security-sensitive. The npm package settings,
workflow filename, repository identity, and GitHub environment must agree
exactly or npm will reject the publish request.

Trusted-publisher settings normally live on an existing npm package. If npm
does not offer those settings before the first version exists, the package
owner must make one interactive bootstrap publish with 2FA from the exact
tarball that passed `npm run pack:check`. Configure the trusted publisher and
disable token-based publishing immediately afterward. This is the only
exception to the no-local-publish rule; do not save a bootstrap token in the
repository or GitHub.

## Release requirements

Before creating a release, the commit must be contained in `main` and
`package.json` must have all of the following:

- `name` set to `@solodev1911/second-brain`.
- `private` explicitly set to `false`.
- `license` set to `Apache-2.0`.
- A version matching the release tag exactly after the leading `v`.
- The repository URL pointing to `solodev1911/second-brain-pi`.

The npm artifact must include the extension, skill, Graphify runtime and lock,
root license, root notice, and third-party notices. The publish workflow rejects
an artifact that omits any of those files.

## Prepare a release

1. Choose a version. Use a SemVer pre-release such as `0.1.0-beta.1` until the
   clean-install beta criteria are complete.
2. Update `package.json`, `package-lock.json`, and the changelog in one pull
   request.
3. From a clean checkout, reproduce the CI gates:

   ```sh
   npm ci --legacy-peer-deps --ignore-scripts
   uv sync --directory graphify --locked --extra mcp --no-dev
   npm run check
   npm run pack:check
   ```

4. Inspect the package manifest without publishing:

   ```sh
   npm pack --dry-run
   ```

5. Merge only after both required CI jobs pass.

## Publish

Create a Git tag whose name exactly matches `v` plus the package version. A
signed annotated tag is preferred:

```sh
git switch main
git pull --ff-only
git tag -s v0.1.0-beta.1 -m "Second Brain v0.1.0-beta.1"
git push origin v0.1.0-beta.1
```

Create a GitHub Release from that existing tag. Mark it as a pre-release when
the version contains a hyphen, such as `-beta.1`; leave the pre-release option
off for a stable version. Publishing the GitHub Release starts
`.github/workflows/publish.yml`.

The workflow applies these distribution tags automatically:

- Pre-release SemVer versions publish with npm dist-tag `beta`.
- Stable SemVer versions publish with npm dist-tag `latest`.

The `npm` GitHub environment can require a maintainer to approve the final
publish job after tests and artifact verification succeed.

## Verify the release

After the workflow completes:

```sh
npm view @solodev1911/second-brain version
npm view @solodev1911/second-brain dist-tags
npm view @solodev1911/second-brain --json
```

Confirm that npm displays provenance, then test installation from a fresh Pi
configuration and a temporary Git repository. For a beta, include the version
or beta tag explicitly; do not assume npm's `latest` tag points to it.

Also confirm that the GitHub Release contains accurate release notes and links
to the installation and upgrade instructions.

## Recovery

Deleting a GitHub Release does not remove a published npm version. Prefer
publishing a corrected patch and deprecating the broken version:

```sh
npm deprecate @solodev1911/second-brain@0.1.0-beta.1 "Use 0.1.0-beta.2 instead"
```

Use npm unpublish only for a security emergency and only within npm's allowed
window. Never move an already published version tag to different code.

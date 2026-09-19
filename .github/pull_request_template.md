## What changed

Describe the focused change and the user problem it solves.

## Verification

- [ ] `npm run check`
- [ ] `npm run pack:check`
- [ ] `git diff --check`
- [ ] Added or updated tests for changed behavior
- [ ] Tested from a packed artifact when installation/runtime discovery changed

List any additional manual, Graphify, live-model, or platform testing:

## Safety and compatibility

- [ ] `/remember` remains the only persistence boundary
- [ ] Project-root and executable selection remain host-controlled
- [ ] Current source remains authoritative over memory
- [ ] No credentials, private memories, generated graphs, or machine-specific paths are included
- [ ] Public documentation and `CHANGELOG.md` are updated when users will notice the change

## Limitations

List anything not tested, especially operating systems, Pi versions, providers, large repositories, or failure recovery.

<!-- Thanks for contributing! See CONTRIBUTING.md for the full PR strategy.
     PRs are squash-merged: this title becomes the commit title, so write it
     in imperative mood, e.g. "Fix worker path resolution on Windows". -->

## What problem does this solve?

<!-- The user-facing problem or motivation, not just the code change. Link the issue if one exists: Fixes #123 -->

## What changed?

<!-- Summary of the approach. Call out anything reviewers should look at closely. -->

## Compatibility

- [ ] No breaking change to the suite schema, `.mcpr` language, CLI, or public API
- [ ] Breaking change — specification updated and migration notes included

## Testing

- [ ] `npm run check` passes locally (build + full test suite)
- [ ] New/changed behavior is covered by tests
- [ ] New user-facing failure modes use a stable `MCP-<AREA>-NNN` diagnostic code

## Documentation

- [ ] Docs updated (`docs/*.md`) where behavior changed, or not needed

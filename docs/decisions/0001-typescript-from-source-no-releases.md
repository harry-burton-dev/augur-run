# 0001. The suite is TypeScript run from source on Node, tested with Vitest, and never released

- **Status:** Accepted (Harry, 2026-11-04)
- **Date:** 2026-11-03
- **Decided by:** Harry
- **Replaces:** none. Serves AUGUR's ADR 0050 (the proving run).

## Context

The run suite is a new repository (ADR 0050). It is a tool an operator runs from a checkout against a
deployment, not something a deployment installs. It needs the same toolchain as AUGUR's other repositories,
so anyone who works on one can work on it, and it should cost as little CI as possible.

## Options

1. **TypeScript, run from source with Node 22's type stripping, Vitest for tests, no releases.** The same
   language, lint and test runner as AUGUR's other repositories, with no build step. A run records the
   commit it ran from.
2. **The same, built and released with changesets** like the app repositories. Gives version numbers, but
   nothing installs the suite, so a version adds a release PR and its CI to every change for nothing.
3. **Plain JavaScript, like `pnpm seed`.** No types to check the scenarios' API calls against.

## Decision

Option 1. The suite is TypeScript that Node runs as it is (`erasableSyntaxOnly`), checked by `tsc`, linted
by AUGUR's ESLint setup (its ADR 0043) and tested by Vitest. It has no changesets and no releases: each
run's evidence names the suite's commit, and that is the version that matters.

## Consequences

- No build step and no release workflow, so CI is one job of about a minute on each pull request.
- Only syntax Node can strip is allowed (no enums, namespaces or parameter properties); `tsc` enforces it.
- Node 22.18 or later is needed, for type stripping without a flag.

## Links

Linear PER-296. AUGUR's ADRs 0043 (lint) and 0050 (the proving run).

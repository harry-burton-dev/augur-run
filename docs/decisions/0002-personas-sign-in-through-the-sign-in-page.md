# 0002. Personas sign in through the real sign-in page, approved by a headless browser (Playwright)

- **Status:** Accepted (Harry, 2026-11-04)
- **Date:** 2026-11-03
- **Decided by:** Harry
- **Replaces:** none. Builds on AUGUR's ADR 0056 (the seed signs in with the device grant).

## Context

The run's personas are the sample people `pnpm seed` makes. Each starts with a one-time password and must
choose a new one at first sign-in, as every new person does. The realm allows no password sign-in from a
script: the shell's client allows only the browser sign-in, and direct password sign-in is off everywhere.
The one way in for a script is the `platform-cli` client's device grant (RFC 8628), whose code a person
approves on the sign-in page. The run gate also has checks only a browser can make, such as the app frame's
layout at tablet widths (alpha spec, Goal 20).

## Options

1. **The device grant, with each code approved on the real sign-in page by a headless browser
   (Playwright, Chromium only).** No realm change, the sign-in page is exercised as people use it, and the
   same browser serves later layout checks. Playwright is already AUGUR's browser tool (its contract tests);
   the browser is installed only where the dry run runs.
2. **Post the sign-in forms with plain HTTP.** No browser, but it reads the theme's HTML by hand, breaks when
   the theme changes, and still leaves Goal 20 without a browser.
3. **A realm client with direct password sign-in for sample people.** Simplest, but turns on a grant the
   realm keeps off on purpose, on a deployment that later opens to testers.

## Decision

Option 1. The suite starts a device code for each persona and a headless Chromium driven by Playwright
approves it on the deployment's own sign-in page: name and password, a new password the first time, and the
grant. The page is read by its form fields, never its wording. Passwords the suite chooses are kept only in
the run's working folder (`.run/`, mode 0600, ignored by git). Playwright's version follows AUGUR's contract
tests.

## Consequences

- No change to the realm, and a broken sign-in page shows up in the run as it would for a person.
- The dry run's CI job installs Chromium (about a minute). The pull request check skips the browser test
  unless a browser is there.
- Two-step sign-in for sample admins (ADR 0038) needs the suite to answer a one-time code; until then a
  persona asked for one stops with that reason.
- The check: `src/browser.test.ts` walks a stand-in for the sign-in pages in a real browser.

## Links

Linear PER-296. AUGUR's ADRs 0038 (two-step sign-in for admins), 0050 (the proving run) and 0056 (the seed).

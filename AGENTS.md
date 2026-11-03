# The run suite: notes for coding agents

`augur-run` is AUGUR's run suite (im-platform ADR 0050): scripted synthetic use that proves a release on a
real deployment. It signs in the seeded cast of sample people, follows a 48-hour timeline of scenarios,
records evidence of every call, and keeps the run ledger that decides whether the run passed. After alpha
it stays as AUGUR's regression suite. AUGUR itself, its ADRs and its guides are in the `im-platform`
repository; read its AGENTS.md and ADRs 0050 and 0056 before changing what the suite checks.

## Where to look
- AUGUR's ADRs (`im-platform` docs/decisions), especially 0050 (the proving run), 0056 (the seed and its
  cast) and 0045 (the bake gate).
- This repository's own decisions: `docs/decisions/` here.
- `traceability.md`: which goal each scenario proves. It is the run gate's checklist.
- The task: its Linear issue (team PER, initiative AUGUR).

## Rules
- The same rules as AUGUR: names, limits and URLs come from config, the seed's cast or the deployment,
  never literals from chat; anything a scenario can't check yet says why and who can change that; a new
  dependency needs a record.
- The suite reaches AUGUR only as a person would: through the gateway and the sign-in page, as a sample
  person from the cast. Never a database, a container or a service's own port.
- It runs only where the deployment allows sample data (`seeding.allowed` on the gateway's Status), the same
  guard as `pnpm seed`. Never point it at a deployment where real people work.
- The cast is the seed's (`im-platform` `scripts/seed/cast.json`, or the file passed with `--cast`). Never
  copy people, floors or texts into this repository.
- Platform scenarios live in `scenarios/platform/`. An app's scenarios live in its own repository's `run/`
  module. Each scenario has a `RUN-nn` id and a row in `traceability.md`; `pnpm test` checks they agree.
- Secrets (one-time and chosen passwords, tokens) live only under `.run/`, which git ignores. `runs/` holds
  exported evidence summaries, never a secret.
- The suite doesn't release: a run records the commit it ran from. So there are no changesets here.
- `pnpm install`, then `pnpm lint`, `pnpm typecheck`, `pnpm test`. Nothing here needs a package token.
- Merge your own pull request once CI is green, after merging fresh `origin/main` into it.
- Nothing in the repository names the tool that wrote it: no assistant trailers on commits or attribution
  in pull requests, and no links to private chats.

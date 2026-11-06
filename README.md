# augur-run

AUGUR's run suite. It proves a release on a real deployment with scripted synthetic use: the sample people
`pnpm seed` makes sign in and work through a 48-hour timeline of scenarios, every call is recorded as
evidence, and every anomaly becomes a row in the run ledger. The run passes when it reached its end with
every scenario [traceability.md](traceability.md) marks Written, and its ledger holds no failure and nothing
unclassified (AUGUR's ADR 0050). Whatever the run didn't prove is a row too (see The ledger).

After alpha it stays as AUGUR's regression suite, run as a dry run against a fresh install whenever the
suite changes.

## What's here

| Path | What it is |
| --- | --- |
| `src/` | The suite: the cast and its synthetic marks, personas, scenarios, the timeline, the ledger and the evidence recorder |
| `scenarios/platform/` | Scenarios for AUGUR itself. Each app's scenarios live in its own repository's `run/` module |
| `traceability.md` | Which goal each scenario proves: the run gate's checklist |
| `runs/` | Exported summaries of finished runs: evidence, ledger and verdict, never a secret |

## Working on it

```sh
pnpm install
pnpm lint && pnpm typecheck && pnpm test
```

Node 22.18 or later runs the TypeScript as it is; there is no build step (decision 0001).

## Running it

A run needs a deployment that allows sample data (`SEED_ALLOWED=true`, shown on Admin's Status) and has
been seeded: in an `augur` checkout beside this one, `pnpm seed --url <AUGUR's address>`. The seed
writes its ledger to `.seed/<host>.json`, with each sample person's one-time password; the run reads it and
signs each person in on the real sign-in page, choosing a new password the first time (decision 0002).

```sh
pnpm exec playwright install chromium          # once: the browser that approves sign-ins
pnpm run-suite run --url https://augur.example.ts.net --dry      # every scenario once, now
pnpm run-suite run --url https://augur.example.ts.net            # the 48-hour timeline
```

| Option | What it does |
| --- | --- |
| `--cast <file>` | The seed's cast (default `../augur/scripts/seed/cast.json`) |
| `--seed-ledger <file>` | The seed's ledger for this deployment (default `../augur/.seed/<host>.json`) |
| `--issuer <realm>` | The sign-in realm, when it isn't at `<url>/sso/realms/platform` |
| `--scenarios <module>` | An app's scenarios, such as `../augur-folio/run/index.ts`; repeat for more |
| `--only RUN-01,RUN-04` | Only these scenarios. A timed run with it never passes: it proves only part of a release |
| `--hours <n>` | The timeline's length (48) |
| `--peak <n>` | The most calls a second across every persona (5, the spec's load) |
| `--seed <n>` | The random seed, to replay a run's choices |

A run keeps its working files in `.run/<host>/<run>/`: the raw evidence, the ledger and the scenarios'
state, with the personas' passwords beside them in `.run/<host>/credentials.json`. None of it goes in git.
At the end it writes `runs/<run>/summary.json` and `report.md`: the verdict, every scenario's outcomes, the
ledger and the calls, with no secret in them. A run stopped part way (Ctrl-C) or one that crashes writes them
too, at once, marked as a run that didn't reach its end, which never passes.

## In CI

Each pull request runs lint, types and the unit tests (about a minute). The **Dry run** workflow installs
the newest AUGUR release fresh on the runner with augur's deploy test, seeds it, and runs every scenario
once (`scripts/dry-run.sh`), about ten minutes. It runs a pull request's own code against the install, so it
runs only when someone asks: by hand from Actions, or by adding the `dry-run` label to a pull request that
changes the suite (`src/`, `scenarios/`, `scripts/`, the lockfile). Without the label the check shows as
skipped, never as passed. Its report is on the run's summary page, and the summary, report, ledger and
evidence are kept as an artifact for 14 days. It needs no secret: the job's own read-only token reads
AUGUR's releases and images, once each image package gives augur-run read access (the package's settings,
Manage Actions access).

## The ledger

Every failed check, and every scenario that stops part way, raises a row in the run's ledger: one row per
incident, however often it repeats. The suite suggests a class; only a person gives one:

```sh
pnpm run-suite ledger .run/<host>/<run>                       # the rows
pnpm run-suite ledger .run/<host>/<run> classify L-003 docs-gap --why "deploy.md missed the relay port" --by Harry
pnpm run-suite ledger .run/<host>/<run> classify L-004 failure --kind missed-alert --why "No alert after 5 minutes" --by Harry
```

Classifying a row exports the summary again. The run passes when no row is a failure and none is left
unclassified (AUGUR's ADR 0050): `no-action`, `documented-setting`, `patch` and `docs-gap` are allowed;
a `failure` (`contract-change`, `undocumented-server-step`, `data-loss` or `missed-alert`) fails the run.

A timed run also raises a row, at its end, for everything it didn't prove: a scenario that never passed
(it was never available, or nobody in the cast could play it), one that never ran in the hours, and a
scenario traceability.md marks Written that wasn't in the run (an app's module not given with
`--scenarios`). A person accepts each with a class and a reason, or the run doesn't pass. A dry run checks
the suite, not a release: it says in its verdict what it didn't prove, and fails only when nothing passed.

## Scenarios

A scenario is one journey from the alpha spec, written as Given, When, Then, with the checks that say it
worked (`src/scenario.ts`). It names the parts people play (an admin, someone on a floor of their own),
how often it happens across the 48 hours (once, every few minutes in the working day, or daily at a set
time), and the goals it proves. A scenario that needs something the deployment doesn't have yet says so
and why, and is reported as not available, never as passed. "Not available" is only for what the
deployment lacks: a call that fails while a scenario asks is a failed check. A scenario passes only when it
ran a check and none failed; one that finds part way it can't prove its point this time (such as no floor
one person reaches and another doesn't) answers like `available` and is reported as not available.

Most scenarios go through the API as the persona. One that checks what a person sees, such as RUN-13's
look at every app on a tablet, asks for `ctx.browse(persona)`: a page in the run's browser, signed in to
AUGUR through the shell's own sign-in, closed when the scenario ends.

### An app's scenarios

Each app's repository keeps its own scenarios in a `run/` module whose `index.ts` exports `scenarios`, in
the shape of `src/scenario.ts`. They are run with `--scenarios ../augur-folio/run/index.ts`, and each gets
a row in [traceability.md](traceability.md). Scenario ids are given out here, so two apps never take the
same one: take the next free `RUN-nn` in the table.

`pnpm run-suite token --url <AUGUR> --username <admin> --password-env <VAR>` signs an admin of a sample
deployment in and prints their access token, for a script such as the dry run that hands it to `pnpm seed`
(`AUGUR_TOKEN`). Like a run, it goes only where the deployment allows sample data; only an admin can read
that on Status, so the check comes after the sign-in. If the sign-in page asks for a new password (a one-time
password), it stops, unless `--set-password` lets it choose one; that password is kept in
`.run/<host>/credentials.json` (or under `--workdir`), and the command says so.

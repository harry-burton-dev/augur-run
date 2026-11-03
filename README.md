# augur-run

AUGUR's run suite. It proves a release on a real deployment with scripted synthetic use: the sample people
`pnpm seed` makes sign in and work through a 48-hour timeline of scenarios, every call is recorded as
evidence, and every anomaly becomes a row in the run ledger. The run passes when every row of
[traceability.md](traceability.md) is green and the ledger holds no failure (AUGUR's ADR 0050).

After alpha it stays as AUGUR's regression suite, run as a dry run against a fresh install whenever the
suite changes.

## What's here

| Path | What it is |
| --- | --- |
| `src/` | The suite: the cast and its synthetic marks, personas, scenarios, the timeline, the ledger and the evidence recorder |
| `scenarios/platform/` | Scenarios for AUGUR itself. Each app's scenarios live in its own repository's `run/` module |
| `traceability.md` | Which goal each scenario proves: the run gate's checklist |
| `runs/` | Exported summaries of finished runs: evidence, ledger and verdict, never a secret |
| `docs/decisions/` | Decisions that only concern the suite |

## Working on it

```sh
pnpm install
pnpm lint && pnpm typecheck && pnpm test
```

Node 22.18 or later runs the TypeScript as it is; there is no build step (decision 0001).

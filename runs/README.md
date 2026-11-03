# Runs

One folder per finished run that counts: the 48-hour run on staging, and any run Harry asks to keep. Each
holds what `pnpm run-suite run` exports at the end, and again after each ledger row is classified:

- `summary.json`: the verdict, every scenario's outcomes, the ledger, call counts, the releases seen, the
  suite's commit and the evidence file's sha256.
- `report.md`: the same, for people, with the verdict first.

The raw evidence and the personas' passwords stay in `.run/` on the operator's machine and never come here.
Dry runs aren't kept: CI keeps each one's report as a workflow artifact.

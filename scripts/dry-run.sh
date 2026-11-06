#!/usr/bin/env bash
# The dry run against a fresh install: augur's deploy test runs this as its THEN command, with AUGUR_URL,
# AUGUR_ADMIN_USER and AUGUR_ADMIN_PASSWORD set (the deploy test, in the AUGUR handbook). It signs the first
# admin in, seeds the install with `pnpm seed`'s cast, then runs every scenario once.
#   AUGUR_CHECKOUT=<augur checkout> WORK=<folder> scripts/dry-run.sh
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
augur=${AUGUR_CHECKOUT:?AUGUR_CHECKOUT names the augur checkout whose seed and cast to use}
work=${WORK:-$here/.run/dry}
mkdir -p "$work"
cd "$here"

# The first admin has a one-time password, so this sign-in chooses their new one: it is kept beside the
# personas' passwords in the run's working folder, which the workflow never uploads.
echo "Signing the first admin in at $AUGUR_URL" >&2
token=$(node src/cli.ts token --url "$AUGUR_URL" --username "$AUGUR_ADMIN_USER" --password-env AUGUR_ADMIN_PASSWORD --set-password --workdir "$work/.run")
echo "::add-mask::$token"

echo "Seeding the install with the seed's cast" >&2
AUGUR_TOKEN=$token node "$augur/scripts/seed.mjs" --url "$AUGUR_URL" --data "$augur/scripts/seed/cast.json" --ledger "$work/seed.json"

echo "Running every scenario once" >&2
node src/cli.ts run --url "$AUGUR_URL" --dry --cast "$augur/scripts/seed/cast.json" --seed-ledger "$work/seed.json" \
  --workdir "$work/.run" --out "$work/runs" --run dry-run

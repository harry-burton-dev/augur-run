# Traceability

The run gate's checklist (AUGUR's ADR 0050, alpha spec "Traceability"). Each row says how one gate goal is
proved: a run scenario here (`RUN-nn`), a CI check in the repository that owns it, the build gate, or a
recorded review. Alpha's run passes when every row is green, the ledger has no failure entry, and the
deviation log has no docs-gap entry.

`pnpm test` checks this table against the scenarios: every scenario has a row naming each goal it proves,
and every `RUN-nn` here is a scenario. A thread that lands a goal's work writes or finishes its scenario and
moves its row's status in the same pull request.

**Status:** **Written** runs today. **Waiting** is written from the journey but reports "not available"
until the work it names lands. **Elsewhere** is proved outside the run, in the place named.
A scenario an app owns is named with its repository's `run/` module, and lives there.

| Goal | What is checked | Proved by | Scenario or check | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | API report unchanged; contract tests on the frozen `sdk-2.0` build and earlier minors | CI | im-platform: API Extractor report, contract tests (CI-nn when written) | Elsewhere | |
| 2, 3 | Every app imports the starters; the reference app's `index.ts` and entry use them | CI and build gate | im-platform and app repositories | Elsewhere | |
| 4 | No hand-written duplicate of an API or wire type; manifests validate against the schema | CI | im-platform: `check-contracts`, `check-manifests` | Elsewhere | |
| 5 | Each repository releases through the shared workflow; staging installs each app from the feed | CI and run | Release workflows; RUN-05 sees every installed app up | Elsewhere | |
| 6 | A new repository from the template runs in the dev shell in 15 minutes or less | Build gate | Recorded with the build gate | Elsewhere | |
| 7 | One shipped-app list; reserved ids are refused | CI | im-platform checks | Elsewhere | |
| 8 | The four ADRs are amended or accepted before W1 | Review | Decision register | Elsewhere | |
| 9, 11, 13 | Invite by email, two-step sign-in, Account, organisation name on Home (CUJ 2) | Run | RUN-07 | Waiting | |
| 11, 12, 36 | Every sample person signs in, choosing their own password, and finds their roles and floors | Run | RUN-01 | Written | |
| 12 | An admin's floor change reaches the person within 5 minutes, and Activity records who did it | Run | RUN-03 | Written | |
| 12 | A leaver is turned off within 5 minutes and their items handed over (CUJ 3) | Run | RUN-08 | Waiting | |
| 12 | Activity keeps before and after, and exports to CSV | Run | RUN-14 | Waiting | |
| 13 | Organisation settings are read by everyone within 5 minutes, and audited (sign-in page and mail not yet checked) | Run | RUN-09 | Written | |
| 14 | The Inbox holds stateful items, apart from notifications; Home shows the counts | Run | RUN-10 | Waiting | |
| 15 to 18 | Kit released on its own version; axe with no serious findings; picker search in place | CI | augur-kit and im-platform contract tests | Elsewhere | |
| 19 | Design decisions recorded before the SDK 2.0 cut | Review | Decision register | Elsewhere | |
| 20 | Every app shows the app frame layout; nothing is covered at tablet widths | Run | RUN-13 | Written | |
| 22 | Settings schema matches compose, `.env.example` and docs; no deployment literals | CI | im-platform `check-settings` | Elsewhere | |
| 23 | A deliberate fault alerts a deployment admin within 5 minutes, by notice and email (CUJ 4) | Run | RUN-12 | Waiting | |
| 23 | Stopping Grafana, then the whole host, raises Backstage's late-report alert | Run (operator) | Recorded by the operator during the run | Elsewhere | |
| 23, 24, 36 | Every service and app answers its health check all through the run | Run | RUN-05 | Written | |
| 24, 36 | The 02:00 UTC backup runs each night of the run | Run | RUN-06 | Written | |
| 24 | Postgres restart and host reboot recover with no double job runs; off-server copy restored; timeouts tested | Run (operator) and CI | Operator drill during the run; im-platform tests | Elsewhere | |
| 25 | The broken release B installs on request and goes back by itself, with no SSH | Run (operator) | Step 3 of the order of events, before the run | Elsewhere | |
| 26 | Scans, pins, rulesets and token scope in every signing repository; fail-closed signed caller | CI | `check-repo-security` in each repository | Elsewhere | |
| 27 | Staging install with an empty deviation log (CUJ 5) | Run (operator) | The deviation log | Elsewhere | |
| 28 | A feature preview turned on for one floor only | Run | RUN-11 | Waiting | |
| 29, 30, 36 | People read only where their floors allow | Run | RUN-02 | Written | |
| 29, 33a | Binding events; Data Atlas shows what points at an entity (CUJ 6) | Run | Each pillar's own `run/` module (augur-atlas, augur-mandate) | Elsewhere | |
| 30 | What is published up a floor is found and opened there, under its library's name, and nowhere else (CUJ 6) | Run | RUN-15, in augur-folio's `run/` module | Written | |
| 34 | Zero im-platform PRs made for the reference app | Build gate | The reference app's gate script | Elsewhere | |
| 35 to 38 | The run ledger has no failure entry; the order of events holds | Run | The ledger (`pnpm run-suite ledger`) and the run's report in `runs/` | Elsewhere | |
| 36 | The run carries the spec's load, so the watch and the alerts have counts | Run | RUN-04 | Written | |

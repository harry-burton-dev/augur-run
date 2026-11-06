// One run, start to end: load the cast and the seed's ledger, sign an admin persona in to check the
// deployment allows sample data, then play the timeline (or the dry run) and export the evidence.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { limiter, personaApi, type Api } from './api.ts';
import type { Browse } from './browser.ts';
import { exportRun, openRecorder } from './evidence.ts';
import { openLedger } from './ledger.ts';
import { personasFrom, rng, type Persona } from './personas.ts';
import { runScenario, scenarioProblems, type Scenario } from './scenario.ts';
import { openCredentials, signIn, tokenKeeper, type Approver, type Tokens } from './signin.ts';
import { checkAllowed, loadCast, loadSeedLedger, RunRefused } from './synthetic.ts';
import { dryPlan, plan, play, realClock, type Clock, type WorkingDay } from './timeline.ts';

export type RunOptions = {
  gateway: string;
  issuer: string;
  castPath: string;
  seedLedgerPath: string;
  scenarios: Scenario[];
  approve: Approver;
  /** Opens AUGUR in a browser as a persona, for scenarios that look at the screen. */
  browse?: Browse;
  mode: 'dry' | 'timeline';
  hours?: number;
  /** The run's peak rate across every persona, in calls a second (the spec's load: 5). */
  peakPerSecond?: number;
  parallel?: number;
  seed?: number;
  run?: string;
  /** Where the run's secrets and raw evidence go: `.run/` by default, ignored by git. */
  workDir?: string;
  /** Where the exported summary goes: `runs/` by default. */
  outDir?: string;
  suiteCommit?: string;
  day?: WorkingDay;
  clock?: Clock;
  fetchImpl?: typeof fetch;
  log?: (line: string) => void;
  /** Set when only some scenarios were picked (`--only`): such a timed run can't pass. */
  partial?: string;
  /**
   * The scenario ids a full run must include: those traceability.md marks Written. A timed run that leaves
   * one out (an app's module not given with --scenarios) raises a row for it.
   */
  expected?: string[];
  /** Stops the run: what it has so far is exported at once, marked as not reaching its end. */
  signal?: AbortSignal;
};

type Meta = { run: string; gateway: string; mode: 'dry' | 'timeline'; suiteCommit?: string; outDir: string; partial?: string; ended?: boolean; stopped?: string };

const MINUTE = 60_000;

/** Why the run stopped, from an abort reason or an error, in words. */
const reasonOf = (reason: unknown) => (reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : 'it was stopped.');

type Component = { name: string; kind?: string; state?: string; version?: string };
export type StatusBody = { components?: Component[]; seeding?: { allowed: boolean; why?: string; whoCanChange?: string } };

export const hostOf = (gateway: string) => new URL(gateway).host.replace(/[^a-z0-9.-]/gi, '_');

/** The release the deployment is running, as its gateway reports it. */
export const releaseOf = (status: StatusBody) => status.components?.find((c) => c.name === 'gateway')?.version;

export const startRun = async (o: RunOptions) => {
  const log = o.log ?? ((line: string) => console.log(line));
  const clock = o.clock ?? realClock;
  const problems = scenarioProblems(o.scenarios);
  if (problems.length) throw new RunRefused(`The scenarios can't be run:\n  - ${problems.join('\n  - ')}`);

  const cast = loadCast(o.castPath);
  const seeded = loadSeedLedger(o.seedLedgerPath, o.gateway);
  const { personas, missing } = personasFrom(cast, seeded);
  for (const m of missing) log(`– ${m.key} isn't in the run: ${m.why}`);
  if (!personas.length) throw new RunRefused('Nobody from the cast is on this deployment, so the run has nobody to sign in. Run `pnpm seed` first.');

  const started = new Date(clock.now());
  const run = o.run ?? `${hostOf(o.gateway)}-${started.toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
  const deploymentDir = join(o.workDir ?? '.run', hostOf(o.gateway));
  const runDir = join(deploymentDir, run);
  mkdirSync(runDir, { recursive: true });
  const outDir = o.outDir ?? 'runs';
  // A dry run is a check of the suite, not of a release, so only a timed run is held to every scenario.
  const partial = o.mode === 'timeline' ? o.partial : undefined;
  const meta: Meta = { run, gateway: o.gateway, mode: o.mode, suiteCommit: o.suiteCommit, outDir, ...(partial ? { partial } : {}) };
  const writeMeta = (more: Partial<Meta>) => writeFileSync(join(runDir, 'meta.json'), `${JSON.stringify(Object.assign(meta, more), null, 2)}\n`);
  writeMeta({});
  const now = () => new Date(clock.now());
  const evidence = openRecorder(join(runDir, 'evidence.jsonl'), now);
  const ledger = openLedger(join(runDir, 'ledger.jsonl'), now);
  const credentials = openCredentials(join(deploymentDir, 'credentials.json'));
  const statePath = join(runDir, 'state.json');
  const states: Record<string, Record<string, unknown>> = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {};
  const limit = limiter(o.peakPerSecond ?? 5, clock.now, clock.sleep);
  const random = rng(o.seed ?? started.getTime() % 2 ** 31);
  evidence.note({ text: 'Run started', data: { run, mode: o.mode, gateway: o.gateway, seed: o.seed, suiteCommit: o.suiteCommit, personas: personas.map((p) => p.key), missing } });

  // One sign-in per persona for the whole run, refreshed as it goes.
  const tokens = new Map<string, () => Promise<string>>();
  const tokenFor = (p: Persona) => {
    let t = tokens.get(p.key);
    if (!t) {
      const again = (): Promise<Tokens> =>
        signIn({ issuer: o.issuer, username: p.username, credentials, temporaryPassword: p.temporaryPassword, approve: o.approve, fetchImpl: o.fetchImpl });
      let keeper: Promise<() => Promise<string>> | undefined;
      t = async () => {
        keeper ??= again().then((first) => tokenKeeper({ issuer: o.issuer, first, again, fetchImpl: o.fetchImpl, now: clock.now }));
        try {
          return await (await keeper)();
        } catch (err) {
          keeper = undefined; // the next call tries the sign-in again
          throw err;
        }
      };
      tokens.set(p.key, t);
    }
    return t;
  };
  const apiFor = (p: Persona, scenario?: string): Api =>
    personaApi({ gateway: o.gateway, token: tokenFor(p), persona: p.key, scenario, evidence, limit, fetchImpl: o.fetchImpl });

  // A browser signed in as the persona. The API sign-in comes first, so their own password is chosen.
  const browse = o.browse
    ? async (p: Persona) => {
        await tokenFor(p)();
        return o.browse!({ url: o.gateway, username: p.username, passwords: credentials.candidates(p.username, p.temporaryPassword) });
      }
    : undefined;

  // The guard: a sample admin signs in and reads the gateway's Status. Only where sample data is allowed.
  const admin = personas.find((p) => p.roles.includes('admin'));
  if (!admin) throw new RunRefused('The cast has no sample admin, so the run can’t check that this deployment allows sample data. Give one sample person the admin role in the cast.');
  const status = await apiFor(admin).get<StatusBody>('/api/gateway/v1/status');
  if (!status.ok) throw new RunRefused(`The gateway's Status answered ${status.status} to the sample admin, so the run can't check that sample data is allowed here.`);
  checkAllowed(status.body);
  let release = releaseOf(status.body);
  evidence.release({ release: release ?? 'unknown', components: status.body.components });
  log(`Run ${run} on ${o.gateway}, release ${release ?? 'unknown'}, ${personas.length} personas, ${o.mode === 'dry' ? 'dry run' : `${o.hours ?? 48} hours`}.`);

  // The release is looked at again every 15 minutes, and when a row is raised, so a patch installed during
  // the run is on its rows. A failed look (the sign-in down in a drill) is noted, never thrown: it must not
  // end the run at the moment it should be recording the fault.
  let releaseCheckedAt = clock.now();
  const lookAtRelease = () => {
    releaseCheckedAt = clock.now();
    apiFor(admin)
      .get<StatusBody>('/api/gateway/v1/status')
      .then((s) => {
        const r = s.ok ? releaseOf(s.body) : undefined;
        if (r && r !== release) {
          release = r;
          evidence.release({ release: r, components: s.body.components });
          log(`The deployment is now on ${r}.`);
        }
      })
      .catch((err: unknown) => evidence.note({ text: 'The release couldn’t be looked at', data: { why: reasonOf(err) } }));
  };
  const releaseNow = () => {
    if (clock.now() - releaseCheckedAt > 15 * MINUTE) lookAtRelease();
    return release;
  };
  const watch = setInterval(() => releaseNow(), 15 * MINUTE);
  watch.unref();

  const byId = new Map(o.scenarios.map((s) => [s.id, s]));
  const events = o.mode === 'dry' ? dryPlan(o.scenarios, clock.now()) : plan(o.scenarios, { start: clock.now(), hours: o.hours ?? 48, random, day: o.day });
  const outcomes: Record<string, Record<string, number>> = {};
  const lastWhy: Record<string, string> = {};

  // Stopped (by the operator, or a crash): export what there is now, as a run that didn't reach its end.
  let stoppedExport: ReturnType<typeof exportRun> | undefined;
  const stop = (why: string) => {
    if (stoppedExport) return stoppedExport;
    evidence.note({ text: 'Run stopped', data: { why, outcomes } });
    writeMeta({ stopped: why });
    stoppedExport = exportRun({ run, gateway: o.gateway, mode: o.mode, evidencePath: evidence.path, ledger: ledger.rows(), outDir, suiteCommit: o.suiteCommit, stopped: why, partial });
    log(`Not passed: the run stopped (${why}). What it had is in ${stoppedExport.dir}.`);
    return stoppedExport;
  };
  const onAbort = () => void stop(reasonOf(o.signal?.reason));
  if (o.signal?.aborted) onAbort();
  o.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    await play(events, {
      clock,
      parallel: o.mode === 'dry' ? 1 : o.parallel,
      stop: () => !!o.signal?.aborted,
      late: (e, by) => evidence.note({ scenario: e.scenario, text: `Started ${Math.round(by / 60_000)} minutes late` }),
      run: async (e) => {
        const scenario = byId.get(e.scenario)!;
        const { outcome, why } = await runScenario(scenario, {
          personas,
          cast,
          seeded,
          evidence,
          ledger,
          apiFor,
          release: releaseNow,
          random,
          now,
          state: (id) => (states[id] ??= {}),
          saveState: () => writeFileSync(statePath, `${JSON.stringify(states, null, 2)}\n`),
          dry: o.mode === 'dry',
          sleep: clock.sleep,
          browse,
        });
        (outcomes[e.scenario] ??= {})[outcome] = (outcomes[e.scenario]?.[outcome] ?? 0) + 1;
        if (why) lastWhy[e.scenario] = why;
        if (o.mode === 'dry' || outcome !== 'passed') log(`${outcome === 'passed' ? '✓' : outcome === 'not-available' || outcome === 'no-persona' ? '–' : '✗'} ${scenario.id} ${scenario.title}${why ? `: ${why}` : ''}`);
      },
    });
  } catch (err) {
    stop(`it crashed: ${reasonOf(err)}`);
    throw err;
  } finally {
    clearInterval(watch);
    o.signal?.removeEventListener('abort', onAbort);
  }
  if (stoppedExport) return { run, runDir, ...stoppedExport };

  // The timed run proves a release, so whatever it didn't prove is a row for a person to classify: a
  // scenario that never passed, one that never ran in the hours, and a Written one left out of the run.
  if (o.mode === 'timeline' && !partial) {
    const gap = (id: string, what: string) => ledger.raise({ key: `${id}: not proved`, what, scenario: id, release, suggested: 'failure' });
    for (const s of o.scenarios) {
      const seen = outcomes[s.id];
      if (!seen) gap(s.id, `${s.id} ${s.title}: it never ran in this run’s ${o.hours ?? 48} hours, so goal ${s.goals.join(', ')} isn’t proved by it.`);
      else if (!seen.passed && !seen.failed && !seen.error) {
        gap(s.id, `${s.id} ${s.title}: it never passed in this run (${Object.entries(seen).map(([k, n]) => `${k} ${n}`).join(', ')}), so goal ${s.goals.join(', ')} isn’t proved by it. ${lastWhy[s.id] ?? ''}`.trim());
      }
    }
    for (const id of o.expected ?? []) {
      if (!byId.has(id)) gap(id, `${id} is Written in traceability.md but wasn’t in this run: give its app’s module with --scenarios, or say why it is left out.`);
    }
  }

  evidence.note({ text: 'Run ended', data: { outcomes } });
  writeMeta({ ended: true });
  const exported = exportRun({ run, gateway: o.gateway, mode: o.mode, evidencePath: evidence.path, ledger: ledger.rows(), outDir, suiteCommit: o.suiteCommit, partial });
  log(`${exported.summary.verdict.passed ? 'Passed' : 'Not passed'}: ${exported.summary.verdict.reason} Summary in ${exported.dir}.`);
  return { run, runDir, ...exported };
};

/** Exports a run again from its working folder, after its ledger rows have been classified. */
export const reexport = (runDir: string) => {
  const meta = JSON.parse(readFileSync(join(runDir, 'meta.json'), 'utf8')) as Meta;
  // A run still going, or one whose process ended without a word, hasn't reached its end.
  const stopped = meta.ended ? undefined : (meta.stopped ?? 'it hasn’t finished, or its process ended before it could say why.');
  return exportRun({ run: meta.run, gateway: meta.gateway, mode: meta.mode, suiteCommit: meta.suiteCommit, outDir: meta.outDir, partial: meta.partial, stopped, evidencePath: join(runDir, 'evidence.jsonl'), ledger: openLedger(join(runDir, 'ledger.jsonl')).rows() });
};

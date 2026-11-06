import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { reexport, startRun } from './run.ts';
import { notYet, type Scenario } from './scenario.ts';
import { openLedger } from './ledger.ts';
import { fakeFetch, files, GATEWAY } from './test/fixtures.ts';
import type { Clock } from './timeline.ts';

const OIDC = '/sso/realms/platform/protocol/openid-connect';

const deployment = (o: { seeding?: boolean } = {}) =>
  fakeFetch({
    [`POST ${OIDC}/auth/device`]: () => ({ body: { device_code: 'd', user_code: 'U', verification_uri: 'http://augur.test/device', interval: 1, expires_in: 60 } }),
    [`POST ${OIDC}/token`]: () => ({ body: { access_token: 'tok', refresh_token: 'r', expires_in: 300 } }),
    'GET /api/gateway/v1/status': () => ({ body: { components: [{ name: 'gateway', kind: 'gateway', state: 'up', version: '0.17.1' }], seeding: { allowed: o.seeding ?? true, why: 'No sample data here.' } } }),
    'GET /api/identity/v1/me': (_b, h) => ({ body: { id: h.authorization ? 'p-1' : undefined } }),
  });

const scenario = (id: string, run: Scenario['run'], extra: Partial<Scenario> = {}): Scenario => ({
  id,
  title: `Scenario ${id}`,
  owner: 'platform',
  goals: [36],
  given: 'g',
  when: 'w',
  then: 't',
  cadence: { kind: 'once' },
  needs: [{ as: 'someone' }],
  run,
  ...extra,
});

const options = (fetchImpl: typeof fetch, scenarios: Scenario[]) => {
  const f = files();
  return {
    f,
    o: {
      gateway: GATEWAY,
      issuer: `${GATEWAY}/sso/realms/platform`,
      castPath: f.castPath,
      seedLedgerPath: f.seedLedgerPath,
      scenarios,
      approve: async (a: { passwords: string[] }) => ({ usedPassword: a.passwords[0]! }),
      mode: 'dry' as const,
      seed: 7,
      run: 'test-run',
      workDir: join(f.dir, '.run'),
      outDir: join(f.dir, 'runs'),
      fetchImpl,
      log: () => {},
    },
  };
};

describe('a dry run', () => {
  it('runs every scenario once and records how each ended, with failures in the ledger', async () => {
    const { impl, calls } = deployment();
    const { o } = options(impl, [
      scenario('RUN-01', async (ctx) => {
        const me = await ctx.parts.someone!.api.get<{ id: string }>('/api/identity/v1/me');
        ctx.check('the gateway knows who they are', me.ok && me.body.id === 'p-1');
      }),
      scenario('RUN-02', async (ctx) => void ctx.check('something that is wrong', false, { expected: 1, actual: 2 })),
      scenario('RUN-03', async () => {}, { available: notYet('The Inbox isn’t in AUGUR yet.', 'PER-146') }),
      scenario('RUN-04', async () => {}, { needs: [{ as: 'owner', role: 'deployment-admin' }] }),
      scenario('RUN-05', async () => {
        throw new Error('it fell over');
      }),
    ]);
    const { summary, runDir } = await startRun(o);
    expect(Object.fromEntries(Object.entries(summary.scenarios).map(([k, v]) => [k, v.outcomes]))).toEqual({
      'RUN-01': { passed: 1 },
      'RUN-02': { failed: 1 },
      'RUN-03': { 'not-available': 1 },
      'RUN-04': { 'no-persona': 1 },
      'RUN-05': { error: 1 },
    });
    expect(summary.scenarios['RUN-03']!.lastWhy).toBe('The Inbox isn’t in AUGUR yet. (PER-146)');
    expect(summary.ledger.map((r) => [r.scenario, r.suggested, r.release])).toEqual([
      ['RUN-02', 'failure', '0.17.1'],
      ['RUN-05', 'failure', '0.17.1'],
    ]);
    expect(summary.verdict.passed).toBe(false);
    expect(summary.releases[0]?.release).toBe('0.17.1');
    // Every call to the gateway carries a token and a trace id.
    const api = calls.filter((c) => c.path.startsWith('/api/'));
    expect(api.every((c) => c.headers.authorization === 'Bearer tok' && /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/.test(c.headers.traceparent ?? ''))).toBe(true);
    // No secret reaches the evidence.
    expect(readFileSync(join(runDir, 'evidence.jsonl'), 'utf8')).not.toMatch(/temp-|Bearer/);

    // Once a person has classified every row, exporting again passes.
    const l = openLedger(join(runDir, 'ledger.jsonl'));
    l.classify('L-001', 'no-action', 'The test scenario is wrong on purpose.', 'tester');
    l.classify('L-002', 'no-action', 'Thrown on purpose.', 'tester');
    expect(reexport(runDir).summary.verdict.passed).toBe(true);
  });

  it('refuses a deployment that doesn’t allow sample data, before any scenario', async () => {
    const { impl } = deployment({ seeding: false });
    let ran = false;
    const { o } = options(impl, [scenario('RUN-01', async () => void (ran = true))]);
    await expect(startRun(o)).rejects.toThrow(/No sample data here\..*only where seeding is allowed/);
    expect(ran).toBe(false);
  });

  it('refuses scenarios with bad ids or no goal', async () => {
    const { impl } = deployment();
    const { o } = options(impl, [scenario('R-1', async () => {}, { goals: [] })]);
    await expect(startRun(o)).rejects.toThrow(/isn't a scenario id[\s\S]*names no goal/);
  });
});

/** A clock that moves only when the run sleeps, so a timed run takes no time. */
const fakeClock = (): Clock => {
  let t = Date.UTC(2026, 10, 10, 9);
  return { now: () => t, sleep: async (ms) => void (t += ms) };
};

const timed = (fetchImpl: typeof fetch, scenarios: Scenario[], more: Record<string, unknown> = {}) => {
  const { f, o } = options(fetchImpl, scenarios);
  return { f, o: { ...o, mode: 'timeline' as const, hours: 1, clock: fakeClock(), ...more } };
};

const checks = (ok: boolean) => async (ctx: Parameters<Scenario['run']>[0]) => void ctx.check('it worked', ok);

describe('the verdict of a timed run', () => {
  it('raises a row for a scenario that never passed, one that never ran, and a Written one left out', async () => {
    const { o } = timed(deployment().impl, [
      scenario('RUN-01', checks(true)),
      scenario('RUN-02', checks(true), { available: async () => ({ ok: false, why: 'Status doesn’t report it.' }) }),
      scenario('RUN-03', checks(true), { cadence: { kind: 'once', afterMinutes: 120 } }),
    ], { expected: ['RUN-01', 'RUN-02', 'RUN-03', 'RUN-15'] });
    const { summary, runDir } = await startRun(o);
    expect(summary.ledger.map((r) => [r.scenario, r.suggested])).toEqual([
      ['RUN-02', 'failure'],
      ['RUN-03', 'failure'],
      ['RUN-15', 'failure'],
    ]);
    expect(summary.ledger[0]!.what).toMatch(/never passed.*not-available 1.*Status doesn’t report it/);
    expect(summary.ledger[1]!.what).toMatch(/never ran in this run’s 1 hours/);
    expect(summary.ledger[2]!.what).toMatch(/Written in traceability\.md but wasn’t in this run/);
    expect(summary.verdict.passed).toBe(false);
    // A person can still accept each gap, with a reason, and the run then passes.
    const l = openLedger(join(runDir, 'ledger.jsonl'));
    for (const r of l.rows()) l.classify(r.id, 'no-action', 'Not on this deployment, agreed.', 'tester');
    expect(reexport(runDir).summary.verdict.passed).toBe(true);
  });

  it('can’t pass with only some scenarios, or when none passed', async () => {
    const only = timed(deployment().impl, [scenario('RUN-01', checks(true))], { partial: 'only RUN-01' });
    const a = await startRun(only.o);
    expect(a.summary.verdict).toMatchObject({ passed: false, reason: expect.stringMatching(/only RUN-01/) });
    expect(reexport(a.runDir).summary.verdict.passed).toBe(false);
    const none = options(deployment().impl, [scenario('RUN-01', async () => ({ ok: false, why: 'Nothing to look at.' }))]);
    expect((await startRun(none.o)).summary.verdict).toMatchObject({ passed: false, reason: expect.stringMatching(/No scenario passed/) });
  });
});

describe('how a scenario ends', () => {
  it('fails, not "not available", when a call fails while asking; and doesn’t pass with nothing checked', async () => {
    const { o } = options(deployment().impl, [
      scenario('RUN-01', checks(true), { available: async (ctx) => (ctx.check('Status can be read', false), { ok: false, why: 'Status answered 502.' }) }),
      scenario('RUN-02', async () => {}),
      scenario('RUN-03', async (ctx) => (ctx.note('No floor apart.'), { ok: false, why: 'No floor one reaches and the other doesn’t.' })),
      scenario('RUN-04', checks(true)),
    ]);
    const { summary } = await startRun(o);
    expect(Object.fromEntries(Object.entries(summary.scenarios).map(([k, v]) => [k, [v.outcomes, v.lastWhy]]))).toEqual({
      'RUN-01': [{ failed: 1 }, 'Status answered 502.'],
      'RUN-02': [{ 'not-available': 1 }, 'It ran no check, so it proved nothing this time.'],
      'RUN-03': [{ 'not-available': 1 }, 'No floor one reaches and the other doesn’t.'],
      'RUN-04': [{ passed: 1 }, undefined],
    });
    // A dry run says what it didn't prove.
    expect(summary.verdict.reason).not.toMatch(/Not proved/);
  });
});

describe('a run that meets trouble', () => {
  it('carries on when the sign-in fails while it looks at the release again', async () => {
    let grants = 0;
    const impl = fakeFetch({
      [`POST ${OIDC}/auth/device`]: () => ({ body: { device_code: 'd', user_code: 'U', verification_uri: 'http://augur.test/device', interval: 1, expires_in: 60 } }),
      // The first sign-in works; after that the sign-in service is down, as in a fault drill.
      [`POST ${OIDC}/token`]: () => (grants++ === 0 ? { body: { access_token: 'tok', refresh_token: 'r', expires_in: 60 } } : { status: 503, body: { error: 'temporarily_unavailable' } }),
      'GET /api/gateway/v1/status': () => ({ body: { components: [{ name: 'gateway', version: '0.17.1' }], seeding: { allowed: true } } }),
    }).impl;
    const { o } = timed(impl, [
      scenario('RUN-01', async (ctx) => {
        await ctx.sleep(20 * 60_000);
        ctx.check('something that is wrong', false);
      }, { needs: [{ as: 'admin', role: 'admin' }] }),
    ]);
    const { summary } = await startRun(o);
    await new Promise((r) => setTimeout(r, 10));
    expect(summary.ledger.map((r) => r.what)).toEqual(['Scenario RUN-01: something that is wrong.']);
  });

  it('exports what it has when it is stopped, as a run that didn’t reach its end', async () => {
    const stop = new AbortController();
    const { o } = timed(deployment().impl, [
      scenario('RUN-01', async (ctx) => {
        ctx.check('it worked', true);
        stop.abort('the operator stopped it (SIGINT)');
      }),
      scenario('RUN-02', checks(true), { cadence: { kind: 'once', afterMinutes: 30 } }),
    ], { signal: stop.signal });
    const { summary, dir, runDir } = await startRun(o);
    expect(existsSync(join(dir, 'summary.json'))).toBe(true);
    expect(summary.verdict).toMatchObject({ passed: false, reason: expect.stringMatching(/didn’t reach its end: the operator stopped it/) });
    expect(Object.keys(summary.scenarios)).toEqual(['RUN-01']);
    expect(reexport(runDir).summary.verdict.passed).toBe(false);
  });

  it('exports what it has when it crashes', async () => {
    const { o, f } = options(deployment().impl, [scenario('RUN-01', checks(true))]);
    await expect(startRun({ ...o, log: (line: string) => { if (line.startsWith('✓')) throw new Error('the disk is full'); } })).rejects.toThrow(/disk is full/);
    const summary = JSON.parse(readFileSync(join(f.dir, 'runs', 'test-run', 'summary.json'), 'utf8'));
    expect(summary.verdict).toMatchObject({ passed: false, reason: expect.stringMatching(/crashed: the disk is full/) });
  });
});


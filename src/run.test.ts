import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { reexport, startRun } from './run.ts';
import { notYet, type Scenario } from './scenario.ts';
import { openLedger } from './ledger.ts';
import { fakeFetch, files, GATEWAY } from './test/fixtures.ts';

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

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addressesOf, parseArgs, tokenCommand } from './cli.ts';
import { scenarioProblems, type Scenario } from './scenario.ts';
import type { Approver } from './signin.ts';
import { fakeFetch, tempDir } from './test/fixtures.ts';

describe('the command line', () => {
  it('reads commands, flags and repeated flags', () => {
    expect(parseArgs(['run', '--url', 'https://a.test', '--dry', '--scenarios', 'x', '--scenarios', 'y'])).toEqual({ _: ['run'], flags: { url: ['https://a.test'], dry: ['true'], scenarios: ['x', 'y'] } });
  });

  it('finds the sign-in realm the way pnpm seed does', () => {
    expect(addressesOf('https://augur.example.ts.net/')).toEqual({ gateway: 'https://augur.example.ts.net', issuer: 'https://augur.example.ts.net/sso/realms/platform' });
    expect(addressesOf(undefined)).toEqual({ gateway: 'http://localhost:8080', issuer: 'http://localhost:8180/realms/platform' });
  });

  it('says what is wrong with an app’s scenarios in another shape, instead of crashing', () => {
    // The shape augur-app-template's run/index.ts had (6 Nov review).
    const stub = { id: 'RUN-??', title: 'Starter', goal: 0, status: 'Waiting', steps: [], proof: '' } as unknown as Scenario;
    expect(scenarioProblems([stub])).toEqual(expect.arrayContaining([expect.stringMatching(/RUN-\?\? isn't a scenario id/), expect.stringMatching(/names no goal/), expect.stringMatching(/names no persona/), expect.stringMatching(/no `run`/)]));
  });
});

const OIDC = '/sso/realms/platform/protocol/openid-connect';
const URL = 'http://augur.test:8080';

/** A deployment whose sign-in page asks for a new password, as a first admin's one-time password does. */
const firstSignIn = (o: { seeding?: boolean } = {}) => {
  const out: string[] = [];
  const err: string[] = [];
  const workdir = join(tempDir(), '.run');
  let approved = false;
  const approve: Approver = async (a) => {
    if (a.allowNewPassword === false) throw new Error(`AUGUR asks ${a.username} to choose a new password.`);
    approved = true;
    return { usedPassword: a.newPassword };
  };
  const { impl } = fakeFetch({
    [`POST ${OIDC}/auth/device`]: () => ({ body: { device_code: 'd', user_code: 'U', verification_uri: 'x', interval: 1, expires_in: 60 } }),
    [`POST ${OIDC}/token`]: () => (approved ? { body: { access_token: 'the-token', expires_in: 300 } } : { status: 400, body: { error: 'authorization_pending' } }),
    'GET /api/gateway/v1/status': (_b, h) => (h.authorization === 'Bearer the-token' ? { body: { seeding: { allowed: o.seeding ?? true, why: 'Real people work here.' } } } : { status: 401 }),
  });
  const argv = (...more: string[]) => parseArgs(['token', '--url', URL, '--username', 'admin', '--password-env', 'AUGUR_TEST_PASSWORD', '--workdir', workdir, ...more]);
  const deps = { approve, fetchImpl: impl, wait: async () => {}, out: (s: string) => void out.push(s), err: (s: string) => void err.push(s) };
  return { argv, deps, out, err, credentials: join(workdir, 'augur.test_8080', 'credentials.json') };
};

describe('run-suite token', () => {
  process.env.AUGUR_TEST_PASSWORD = 'one-time';

  it('won’t choose a new password unless asked to', async () => {
    const d = firstSignIn();
    await expect(tokenCommand(d.argv(), d.deps)).rejects.toThrow(/new password/);
    expect(d.out).toEqual([]);
  });

  it('with --set-password, keeps the new password where the run keeps its own, and says where', async () => {
    const d = firstSignIn();
    expect(await tokenCommand(d.argv('--set-password'), d.deps)).toBe(0);
    expect(d.out).toEqual(['the-token\n']);
    expect(existsSync(d.credentials)).toBe(true);
    const kept = JSON.parse(readFileSync(d.credentials, 'utf8')) as Record<string, { password: string }>;
    expect(kept.admin!.password).not.toBe('one-time');
    expect(d.err.join('')).toContain(d.credentials);
  });

  it('gives no token for a deployment that doesn’t allow sample data', async () => {
    const d = firstSignIn({ seeding: false });
    await expect(tokenCommand(d.argv('--set-password'), d.deps)).rejects.toThrow(/Real people work here/);
    expect(d.out).toEqual([]);
  });
});

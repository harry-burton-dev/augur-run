import { statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openCredentials, signIn, tokenKeeper, type Approver } from './signin.ts';
import { fakeFetch, tempDir } from './test/fixtures.ts';

const ISSUER = 'http://augur.test/sso/realms/platform';
const OIDC = '/sso/realms/platform/protocol/openid-connect';

const deviceRealm = (o: { pendingFirst?: number } = {}) => {
  let pending = o.pendingFirst ?? 0;
  return fakeFetch({
    [`POST ${OIDC}/auth/device`]: () => ({ body: { device_code: 'dev', user_code: 'ABCD-EFGH', verification_uri: 'http://augur.test/device', verification_uri_complete: 'http://augur.test/device?user_code=ABCD-EFGH', interval: 1, expires_in: 60 } }),
    [`POST ${OIDC}/token`]: (body) => {
      const b = body as Record<string, string>;
      if (b.grant_type === 'refresh_token') return { body: { access_token: `refreshed-${b.refresh_token}`, refresh_token: 'r2', expires_in: 300 } };
      if (pending-- > 0) return { status: 400, body: { error: 'authorization_pending' } };
      return { body: { access_token: 'a1', refresh_token: 'r1', expires_in: 300 } };
    },
  });
};

describe('signing a persona in', () => {
  it('approves the code on the sign-in page, sets a new password the first time, and keeps it', async () => {
    const path = join(tempDir(), 'credentials.json');
    const credentials = openCredentials(path);
    const seen: Parameters<Approver>[0][] = [];
    // The first sign-in: the page asks for a new password, so the new one is what worked.
    const approve: Approver = async (o) => (seen.push(o), { usedPassword: o.newPassword });
    const { impl } = deviceRealm({ pendingFirst: 1 });
    const tokens = await signIn({ issuer: ISSUER, username: 't-ann', credentials, temporaryPassword: 'temp', approve, fetchImpl: impl, wait: async () => {} });
    expect(tokens.access_token).toBe('a1');
    expect(seen[0]).toMatchObject({ url: 'http://augur.test/device?user_code=ABCD-EFGH', userCode: 'ABCD-EFGH', username: 't-ann', passwords: ['temp'] });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    // The next sign-in tries the chosen password first.
    expect(openCredentials(path).candidates('t-ann', 'temp')).toEqual([seen[0]!.newPassword, 'temp']);
  });

  it('keeps a password being set, so a run that stops half way can still sign in', () => {
    const path = join(tempDir(), 'credentials.json');
    const next = openCredentials(path).propose('t-bo');
    expect(openCredentials(path).candidates('t-bo', 'temp')).toEqual([next, 'temp']);
  });

  it('takes the token when the code is granted even if the page walk then went wrong, and stops when it never is', async () => {
    const credentials = openCredentials(join(tempDir(), 'c.json'));
    const failing: Approver = async () => {
      throw new Error('an odd last page');
    };
    const granted = deviceRealm({ pendingFirst: 1 });
    expect((await signIn({ issuer: ISSUER, username: 't-cy', credentials, temporaryPassword: 'x', approve: failing, fetchImpl: granted.impl, wait: async () => {} })).access_token).toBe('a1');
    const never = deviceRealm({ pendingFirst: 1000 });
    await expect(signIn({ issuer: ISSUER, username: 't-cy', credentials, temporaryPassword: 'x', approve: failing, fetchImpl: never.impl, wait: async () => {} })).rejects.toThrow(/odd last page/);
    // Two more polls after the walk failed, then it stops.
    expect(never.calls.filter((c) => c.path.endsWith('/token')).length).toBeLessThanOrEqual(4);
  });

  it('says why when the realm has no client for scripts', async () => {
    const { impl } = fakeFetch({});
    await expect(signIn({ issuer: ISSUER, username: 't-ann', credentials: openCredentials(join(tempDir(), 'c.json')), temporaryPassword: 'x', approve: async () => ({ usedPassword: 'x' }), fetchImpl: impl })).rejects.toThrow(/platform-cli client/);
  });

  it('refreshes a token before it runs out, and signs in again if refreshing fails', async () => {
    let t = 0;
    const { impl } = deviceRealm();
    const again = async () => ({ access_token: 'again', expires_in: 300 });
    const keep = tokenKeeper({ issuer: ISSUER, first: { access_token: 'a1', refresh_token: 'r1', expires_in: 60 }, again, fetchImpl: impl, now: () => t });
    expect(await keep()).toBe('a1');
    t = 40_000;
    expect(await keep()).toBe('refreshed-r1');
    const noRefresh = tokenKeeper({ issuer: ISSUER, first: { access_token: 'a1', expires_in: 60 }, again, fetchImpl: impl, now: () => t });
    t = 80_000;
    expect(await noRefresh()).toBe('again');
  });
});

// RUN-07 against a stand-in identity answering as PER-194's spec says invites will.
import { describe, expect, it } from 'vitest';
import type { ScenarioContext } from '../../src/scenario.ts';
import { invite } from './run-07-invite.ts';

const T0 = Date.UTC(2026, 10, 11, 9, 0);

const deployment = (o: { password?: boolean; noResend?: boolean; email?: string } = {}) => {
  const people = new Map<string, { state: string; count: number }>();
  const audit: { action: string; target: string; actor: { id: string }; detail?: Record<string, unknown> }[] = [];
  const left: string[] = [];
  let n = 0;
  const ok = (body: unknown, status = 200) => ({ ok: status < 300, status, body });
  const api = {
    get: async (path: string) => {
      if (path === '/api/gateway/v1/status') return ok({ email: { state: o.email ?? 'ok' } });
      if (path.startsWith('/api/events/v1/audit')) return ok(audit);
      const p = people.get(path.split('/').pop()!);
      return p ? ok({ id: 'x', state: p.state, invite: { method: 'email', count: p.count } }) : ok({}, 404);
    },
    post: async (path: string) => {
      if (path === '/api/identity/v1/admin/people') {
        const id = `p-${++n}`;
        people.set(id, { state: 'invited', count: 1 });
        audit.push({ action: 'person.added', target: id, actor: { id: 'admin-id' }, detail: { method: 'email' } });
        const expiresAt = new Date(T0 + 72 * 3_600_000).toISOString();
        return ok({ person: { id }, invite: { method: 'email', expiresAt }, ...(o.password ? { temporaryPassword: 'x' } : {}) }, 201);
      }
      const id = path.split('/').at(-2)!;
      if (path.endsWith('/leave')) return left.push(id), ok({});
      if (o.noResend) return ok({}, 404);
      people.get(id)!.count++;
      audit.push({ action: 'person.invite-resent', target: id, actor: { id: 'admin-id' } });
      return ok({ invite: { method: 'email' } });
    },
  };
  const checks: { label: string; ok: boolean }[] = [];
  const state: Record<string, unknown> = {};
  const ctx = {
    parts: { admin: { persona: { key: 'admin', id: 'admin-id' }, api } },
    cast: { synthetic: { usernamePrefix: 'sample-', emailDomain: 'example.test', note: '' } },
    state,
    now: () => new Date(T0),
    check: (label: string, ok: boolean) => (checks.push({ label, ok }), ok),
    note: () => {},
  } as unknown as ScenarioContext;
  return { ctx, checks, left, state };
};

describe('RUN-07, inviting by email', () => {
  it('passes an invite by email, and turns off the last run’s invitee on the next run', async () => {
    const d = deployment();
    await invite.run(d.ctx);
    expect(d.checks.filter((c) => !c.ok)).toEqual([]);
    expect(d.state.invited).toBe('p-1');
    await invite.run(d.ctx);
    expect(d.left).toEqual(['p-1']);
    expect(d.state.invited).toBe('p-2');
  });

  it('fails when a one-time password still comes back, or the invite can’t be sent again', async () => {
    const d = deployment({ password: true, noResend: true });
    await invite.run(d.ctx);
    expect(d.checks.filter((c) => !c.ok).map((c) => c.label)).toEqual(['no one-time password is handed back', 'the admin sends the invite again', 'Activity records the resend']);
  });

  it('waits while email isn’t working, saying who can change that', async () => {
    expect(await invite.available!(deployment().ctx)).toEqual({ ok: true });
    const off = deployment({ email: 'attention' });
    expect(await invite.available!(off.ctx)).toMatchObject({ ok: false, whoCanChange: expect.stringContaining('SMTP_') });
  });
});

// The platform scenarios against a stand-in AUGUR that answers as the real one does, in a dry run. The
// dry-run workflow then runs them against a real fresh install.
import { describe, expect, it } from 'vitest';
import { startRun } from '../../src/run.ts';
import { fakeFetch, files, GATEWAY, seeded } from '../../src/test/fixtures.ts';
import type { Clock } from '../../src/timeline.ts';
import { scenarios } from './index.ts';

const OIDC = '/sso/realms/platform/protocol/openid-connect';

/** A small AUGUR: people, floors and their members, Status and Activity. Tokens name the person. */
const augur = (o: { removalSticks?: boolean } = {}) => {
  const people: { id: string; username: string }[] = Object.values(seeded.people!);
  const members = new Map<string, Set<string>>([
    ['f-1', new Set(['p-1'])],
    ['f-1a', new Set(['p-2'])],
    ['f-2', new Set(['p-3'])],
  ]);
  const roles: Record<string, string[]> = { 'p-1': ['editor', 'publisher'], 'p-2': ['editor'], 'p-3': [], 'p-4': ['admin'] };
  const audit: unknown[] = [];
  const invited = new Map<string, number>();
  // The run's own clock, once a dry run starts one, so an invite's expiry is counted from the run's time.
  let now = () => Date.now();
  const off = new Set<string>();
  // Who has been through the leaver flow: identity never turns a leaver's sign-in on again.
  const left = new Set<string>();
  const prefs = new Map<string, object>();
  // One team item, which anyone may take and give back.
  const item = { id: 'i-1', app: 'mandate', key: 'back-brief/1', kind: 'back-brief', owner: { kind: 'team', id: 'f-1' }, state: 'open', allow: {}, takenBy: undefined as string | undefined, history: [{ at: '', action: 'created' }] };
  // One app with one preview: on for chosen floors and the floors beneath them, else off.
  let preview: { mode: string; floors?: string[]; chosen: boolean } = { mode: 'off', chosen: false };
  const below = (floor: string, top: string) => floor === top || (top === 'f-1' && floor === 'f-1a');
  let org = { name: 'Org', timeZone: 'UTC', sender: { name: 'Org', address: 'augur@example.org' } };
  let signingIn = '';
  const who = (h: Record<string, string>) => h.authorization?.replace('Bearer ', '') ?? '';
  const floorsOf = (id: string) => [
    { id: 'org', kind: 'org', name: org.name },
    ...[...members].filter(([, m]) => m.has(id)).map(([f]) => ({ id: f, kind: 'department', name: f })),
    // A team floor's people can reach the floor above it.
    ...(members.get('f-1a')!.has(id) && !members.get('f-1')!.has(id) ? [{ id: 'f-1', kind: 'department', name: 'f-1' }] : []),
  ];
  const routes: Parameters<typeof fakeFetch>[0] = {
    [`POST ${OIDC}/auth/device`]: () => ({ body: { device_code: 'd', user_code: 'U', verification_uri: 'x', interval: 1, expires_in: 60 } }),
    [`POST ${OIDC}/token`]: () => ({ body: { access_token: people.find((p) => p.username === signingIn)!.id, expires_in: 300 } }),
    'GET /api/gateway/v1/status': (_b, h) =>
      roles[who(h)]?.includes('admin')
        ? { body: { components: [{ name: 'gateway', state: 'up', version: '0.17.1' }, { name: 'identity', state: 'up' }], seeding: { allowed: true }, backups: { state: 'ok', lastBackup: { at: new Date().toISOString(), ok: true }, pointInTime: { at: new Date().toISOString(), ok: true } }, email: { state: 'ok', from: 'augur@example.org', checkedAt: new Date().toISOString() } } }
        : { status: 403, body: { message: 'Only admins.' } },
    'GET /api/identity/v1/me': (_b, h) => (off.has(who(h)) ? { status: 401, body: { message: 'Signed out.' } } : { body: { id: who(h), roles: roles[who(h)] } }),
    'GET /api/identity/v1/me/workspaces': (_b, h) => ({ body: { workspaces: floorsOf(who(h)) } }),
    'GET /api/registry/v1/manifest': (_b, h) => (h['x-workspace-id'] && !floorsOf(who(h)).some((f) => f.id === h['x-workspace-id']) ? { status: 403, body: { error: 'forbidden', message: 'You’re not on that floor.' } } : { body: [] }),
    'GET /api/events/v1/notifications': () => ({ body: [] }),
    'GET /api/identity/v1/me/preferences': (_b, h) => ({ body: prefs.get(who(h)) ?? {} }),
    'PUT /api/identity/v1/me/preferences': (b, h) => (prefs.set(who(h), b as object), { body: b }),
    'GET /api/identity/v1/me/sessions': () => ({ body: [{ id: 's-1' }] }),
    'GET /api/identity/v1/me/sign-ins': () => ({ body: [] }),
    'GET /api/identity/v1/me/data': (_b, h) => ({ body: { you: { id: who(h) }, missing: [] } }),
    'GET /api/events/v1/inbox/counts': (_b, h) => ({ body: { you: item.takenBy === who(h) ? 1 : 0, teams: item.takenBy ? 0 : 1, overdue: 0 } }),
    'GET /api/events/v1/inbox/i-1': () => ({ body: item }),
    'GET /api/events/v1/audit': () => ({ body: audit }),
    'GET /api/registry/v1/feature-previews': (_b, h) => ({
      body: { apps: [{ app: 'folio', name: 'Artifacts', previews: [{ id: 'board-view', name: 'Board view', mode: preview.mode, ended: false, on: preview.mode === 'floors' && !!preview.floors?.some((f) => below(h['x-workspace-id'] ?? '', f)) }] }] },
    }),
    'GET /api/registry/v1/apps/folio/feature-previews': () => ({ body: { defaultMode: 'off', ring: 'production', previews: [{ id: 'board-view', name: 'Board view', ...preview, ended: false, optedIn: 0 }] } }),
    'PUT /api/registry/v1/apps/folio/feature-previews/board-view': (b, h) => {
      const { mode, floors } = b as { mode: string | null; floors?: string[] };
      preview = mode === null ? { mode: 'off', chosen: false } : { mode, floors, chosen: true };
      audit.unshift({ id: `a${audit.length}`, at: new Date().toISOString(), actor: { id: who(h) }, action: 'app.preview-set', target: 'folio' });
      return { body: {} };
    },
    'GET /api/identity/v1/organisation': () => ({ body: org }),
    'PATCH /api/identity/v1/admin/organisation': (b, h) => {
      if (!roles[who(h)]?.includes('admin')) return { status: 403, body: { message: 'Only admins.' } };
      const from = { name: org.name };
      org = { ...org, ...(b as object) };
      audit.unshift({ id: `a${audit.length}`, at: new Date().toISOString(), actor: { id: who(h) }, action: 'organisation.changed', target: 'org', detail: { from, to: b } });
      return { body: org };
    },
  };
  const member = (add: boolean) => (floor: string, person: string, h: Record<string, string>) => {
    if (add || !o.removalSticks) members.get(floor)![add ? 'add' : 'delete'](person);
    audit.unshift({ id: `a${audit.length}`, at: new Date().toISOString(), actor: { id: who(h) }, action: add ? 'department.member-added' : 'department.member-removed', target: floor, detail: { person } });
    return { status: 204 };
  };
  const base = fakeFetch(routes);
  const impl = (async (input: string | URL, init: RequestInit = {}) => {
    const path = new URL(String(input)).pathname;
    const m = path.match(/^\/api\/identity\/v1\/admin\/departments\/([^/]+)\/members\/([^/]+)$/);
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    if (path === '/api/events/v1/inbox') {
      const tab = new URL(String(input)).searchParams.get('tab');
      const me = who(headers);
      const shown = tab === 'you' ? (item.takenBy === me ? [item] : []) : tab === 'teams' ? (item.takenBy ? [] : [item]) : [];
      return new Response(JSON.stringify(shown), { status: 200 });
    }
    const step = path.match(/^\/api\/events\/v1\/inbox\/i-1\/(take|release)$/);
    if (step && init.method === 'POST') {
      item.takenBy = step[1] === 'take' ? who(headers) : undefined;
      item.history.push({ at: '', action: step[1] === 'take' ? 'taken' : 'released' });
      return new Response(JSON.stringify(item), { status: 200 });
    }
    // A person added with a one-time password, which their first sign-in replaces.
    const added = path === '/api/identity/v1/admin/people' && init.method === 'POST' ? (JSON.parse(String(init.body)) as { start?: string; username?: string; email: string; roles?: string[] }) : undefined;
    if (added?.start === 'temporary-password') {
      const id = `p-added-${people.length + 1}`;
      people.push({ id, username: added.username ?? added.email });
      roles[id] = added.roles ?? [];
      audit.unshift({ id: `a${audit.length}`, at: new Date().toISOString(), actor: { id: who(headers) }, action: 'person.added', target: id, detail: { method: 'temporary-password' } });
      return new Response(JSON.stringify({ person: { id, username: added.username, email: added.email }, invite: { method: 'temporary-password' }, temporaryPassword: 'one-time' }), { status: 201 });
    }
    // Invites by email (PER-194): a new person, an invite that lasts 72 hours, and a resend.
    if (added) {
      const id = `p-invited-${invited.size + 1}`;
      invited.set(id, 1);
      audit.unshift({ id: `a${audit.length}`, at: new Date().toISOString(), actor: { id: who(headers) }, action: 'person.added', target: id, detail: { method: 'email' } });
      const expiresAt = new Date(now() + 72 * 3_600_000).toISOString();
      return new Response(JSON.stringify({ person: { id }, invite: { method: 'email', expiresAt } }), { status: 201 });
    }
    const invite = path.match(/^\/api\/identity\/v1\/admin\/people\/([^/]+)\/invite$/);
    if (invite && init.method === 'POST' && invited.has(invite[1]!)) {
      invited.set(invite[1]!, invited.get(invite[1]!)! + 1);
      audit.unshift({ id: `a${audit.length}`, at: new Date().toISOString(), actor: { id: who(headers) }, action: 'person.invite-resent', target: invite[1] });
      return new Response(JSON.stringify({ invite: { method: 'email' } }), { status: 200 });
    }
    const asked = path.match(/^\/api\/identity\/v1\/admin\/people\/([^/]+)$/)?.[1];
    if (asked && invited.has(asked) && (init.method ?? 'GET') === 'GET') {
      return new Response(JSON.stringify({ id: asked, state: 'invited', invite: { method: 'email', count: invited.get(asked) } }), { status: 200 });
    }
    const person = path.match(/^\/api\/identity\/v1\/admin\/people\/([^/]+)(\/leave)?$/);
    if (person) {
      const id = person[1]!;
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : {};
      if (person[2] && init.method === 'POST') {
        if (left.has(id)) return new Response(JSON.stringify({ error: 'conflict', message: 'They’ve already left.' }), { status: 409 });
        off.add(id);
        left.add(id);
        audit.unshift({ id: `a${audit.length}`, at: new Date().toISOString(), actor: { id: who(headers) }, action: 'person.left', target: id, detail: { handOverTo: body.handOverTo } });
      } else if (init.method === 'PATCH' && body.enabled) {
        if (left.has(id)) return new Response(JSON.stringify({ error: 'conflict', message: 'They’ve left, and a leaver doesn’t come back. Add them again if they return.' }), { status: 409 });
        off.delete(id);
      }
      return new Response(JSON.stringify({ id }), { status: 200 });
    }
    if (path === '/api/events/v1/audit/export') {
      const format = new URL(String(input)).searchParams.get('format');
      const rows = [...audit] as { id: string }[];
      audit.unshift({ id: `a${audit.length}`, at: new Date().toISOString(), actor: { id: who(headers) }, action: 'audit.exported' });
      const text = format === 'jsonl' ? rows.map((r) => `${JSON.stringify(r)}\n`).join('') : `at,actor,actorKind,app,action,target,floor,detail\n${rows.map(() => 'row\n').join('')}`;
      return new Response(text, { status: 200 });
    }
    if (m && (init.method === 'PUT' || init.method === 'DELETE')) {
      const r = member(init.method === 'PUT')(m[1]!, m[2]!, headers);
      return new Response(null, { status: r.status });
    }
    return base.impl(input, init);
  }) as typeof fetch;
  return { impl, left, setSigningIn: (u: string) => (signingIn = u), setClock: (f: () => number) => (now = f) };
};

describe('the platform scenarios in a dry run', () => {
  const dry = async (a: ReturnType<typeof augur>) => {
    const f = files();
    let t = Date.UTC(2026, 10, 10, 12);
    const clock: Clock = { now: () => t, sleep: async (ms) => void (t += ms) };
    a.setClock(clock.now);
    const { summary } = await startRun({
      gateway: GATEWAY,
      issuer: `${GATEWAY}/sso/realms/platform`,
      castPath: f.castPath,
      seedLedgerPath: f.seedLedgerPath,
      scenarios,
      approve: async (o) => (a.setSigningIn(o.username), { usedPassword: o.passwords[0]! }),
      mode: 'dry',
      seed: 3,
      run: 'platform',
      workDir: `${f.dir}/.run`,
      outDir: `${f.dir}/runs`,
      fetchImpl: a.impl,
      clock,
      log: () => {},
    });
    return summary;
  };

  it('pass against an AUGUR that keeps its promises, and the waiting ones say what they wait on', async () => {
    const a = augur();
    const summary = await dry(a);
    const outcome = (id: string) => Object.keys(summary.scenarios[id]?.outcomes ?? {});
    for (const id of ['RUN-01', 'RUN-02', 'RUN-03', 'RUN-04', 'RUN-05', 'RUN-06', 'RUN-07', 'RUN-08', 'RUN-09', 'RUN-10', 'RUN-11', 'RUN-14', 'RUN-16', 'RUN-17', 'RUN-18']) expect([id, outcome(id)]).toEqual([id, ['passed']]);
    for (const id of ['RUN-12', 'RUN-13']) expect([id, outcome(id)]).toEqual([id, ['not-available']]);
    expect(summary.ledger).toEqual([]);
    expect(summary.verdict.passed).toBe(true);
    // RUN-08's leaver is a sample person it added: nobody from the seed's cast left.
    const seededIds = new Set(Object.values(seeded.people!).map((p) => p.id));
    expect([...a.left]).toEqual([expect.stringMatching(/^p-added-/)]);
    expect([...a.left].filter((id) => seededIds.has(id))).toEqual([]);
  });

  it('raise a ledger row when access isn’t gone within 5 minutes', async () => {
    const summary = await dry(augur({ removalSticks: true }));
    expect(summary.ledger.map((r) => r.what)).toEqual([expect.stringMatching(/RUN|takes them off.*can no longer reach .* within 5 minutes/)]);
    expect(summary.verdict.passed).toBe(false);
  });
});
